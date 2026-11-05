import { describe, expect, it } from 'vitest'
import { Limiter } from '../../server/gateway/upstream/limiter'

const base = { userId: 'u', tokenId: 't', upstreamId: 'up', userPerMin: 120, ratePerMin: 60, maxConcurrent: 5 }

describe('limiter', () => {
  it('61st call in a minute fails immediately with retry_after', () => {
    let t = 0
    const l = new Limiter(() => t)
    for (let i = 0; i < 60; i++) { const r = l.acquire(base); expect(r.ok).toBe(true); if (r.ok) r.release() }
    const r = l.acquire(base)
    expect(r).toMatchObject({ ok: false, scope: 'upstream', retryAfterSec: 1 })
    t += 1000
    expect(l.acquire(base).ok).toBe(true)
  })
  it('concurrency without queue', () => {
    const l = new Limiter(() => 0)
    const held = Array.from({ length: 5 }, () => l.acquire({ ...base, ratePerMin: 600, userPerMin: 600 }))
    expect(held.every(h => h.ok)).toBe(true)
    expect(l.acquire({ ...base, ratePerMin: 600, userPerMin: 600 })).toMatchObject({ ok: false, scope: 'concurrency' })
    if (held[0]!.ok) held[0]!.release()
    expect(l.acquire({ ...base, ratePerMin: 600, userPerMin: 600 }).ok).toBe(true)
  })
  it('limits are per upstream, not shared', () => {
    const l = new Limiter(() => 0)
    for (let i = 0; i < 60; i++) { const r = l.acquire({ ...base, upstreamId: 'a' }); if (r.ok) r.release() }
    expect(l.acquire({ ...base, upstreamId: 'a' }).ok).toBe(false)
    expect(l.acquire({ ...base, upstreamId: 'b' }).ok).toBe(true)
  })
  it('user and token scopes, order user -> token -> upstream, no token consumed on denial', () => {
    const l = new Limiter(() => 0)
    const cfg = { ...base, userPerMin: 2, ratePerMin: 60 }
    l.acquire(cfg); l.acquire(cfg)
    expect(l.acquire(cfg)).toMatchObject({ ok: false, scope: 'user' })
    const l2 = new Limiter(() => 0)
    l2.acquire({ ...cfg, userId: 'x', tokenId: 'T' }); l2.acquire({ ...cfg, userId: 'y', tokenId: 'T' })
    expect(l2.acquire({ ...cfg, userId: 'z', tokenId: 'T' })).toMatchObject({ ok: false, scope: 'token' })
  })
  it('upstream Retry-After blocks until then; hits counted', () => {
    let t = 0
    const l = new Limiter(() => t)
    l.blockUpstream('up', 30)
    expect(l.acquire(base)).toMatchObject({ ok: false, scope: 'upstream', retryAfterSec: 30 })
    expect(l.hitsLast5m('up')).toBe(1)
    t = 31_000
    expect(l.acquire(base).ok).toBe(true)
    t = 400_000
    expect(l.hitsLast5m('up')).toBe(0)
  })
  it('release is idempotent', () => {
    const l = new Limiter(() => 0)
    const r = l.acquire(base)
    if (r.ok) { r.release(); r.release() }
    expect(l.inflightCount('u', 'up')).toBe(0)
  })
})
