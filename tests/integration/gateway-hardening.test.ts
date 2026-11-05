import { randomBytes } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { ctxFor, makeGateway, sig } from '../helpers/gateway'
import { ToolNotFoundError } from '../../server/gateway/ports'
import { connectUpstream } from '../../server/gateway/upstream/connect'
import { Breaker } from '../../server/gateway/upstream/breaker'
import { UpstreamHealth } from '../../server/gateway/upstream/status'
import { Limiter } from '../../server/gateway/upstream/limiter'
import { IpcTransport } from '../../server/gateway/stdio/ipc-transport'
import { StatsBuffer, type CallStatRow } from '../../server/gateway/stats/buffer'
import { decryptSecret, encryptSecret } from '../../server/gateway/crypto/secrets'
import type { UpstreamRow } from '../../server/gateway/upstream/types'

let a: FakeHttp
beforeAll(async () => { a = await startFakeHttp() })
afterAll(async () => { await a.close() })
afterEach(() => { a.state.mode = 'ok'; a.state.calls = {} })
let h: ReturnType<typeof makeGateway>
afterEach(async () => { await h?.gw.shutdown(300) })

describe('tenant binding (M1)', () => {
  it('a store that returns a foreign upstream row is ignored by list and call', async () => {
    h = makeGateway()
    const foreign = h.store.addUpstream('B', { slug: 'one', url: a.url })
    h.store.listEnabledUpstreams = async () => [foreign]
    h.store.getUpstreamBySlug = async () => foreign
    const ctx = ctxFor('A')
    expect(await h.gw.toolSource.listTools(ctx)).toEqual([])
    await expect(h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
    expect(a.state.requests.length).toBe(0)
  })
  it('pool and credentials refuse an owner that differs from the row', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('B', { slug: 'one', url: a.url })
    await expect(h.gw.pool.get(up, undefined, 'A')).rejects.toThrow('owner mismatch')
    await expect(h.gw.credentials(up, 'A')).rejects.toThrow('owner mismatch')
  })
  it('secrets are decrypted with the owner key from the auth context: a row re-assigned to another user does not decrypt', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('B', { slug: 'one', url: a.url, authType: 'bearer' })
    h.store.secrets.push({ userId: 'B', upstreamId: up.id, kind: 'bearer', name: '', ciphertext: encryptSecret(h.masterKey, 'B', { upstreamId: up.id, kind: 'bearer', name: '' }, 'tok') })
    expect((await h.gw.credentials(up, 'B')).bearer).toBe('tok')
    // same row under a foreign user key: GCM tag does not match
    expect(() => decryptSecret(h.masterKey, 'A', { upstreamId: up.id, kind: 'bearer', name: '' }, h.store.secrets[0]!.ciphertext)).toThrow()
  })
})

describe('breaker probe release (M2) and cache hits (M3)', () => {
  const half = () => {
    let t = 0
    const b = new Breaker(() => t)
    for (let i = 0; i < 5; i++) b.failure()
    t += 10 * 60_000
    return b
  }
  it('auth failure in half-open releases the probe slot', () => {
    const b = half()
    const hl = new UpstreamHealth('u', 'id', { enabled: true, setup: 'ready', status: 'unknown' }, { onChange: () => {} }, () => 0)
    ;(hl as unknown as { breaker: Breaker }).breaker = b
    expect(b.allow()).toBe(true)
    expect(b.allow()).toBe(false)
    hl.failure('auth')
    expect(b.allow()).toBe(true) // before: permanently blocked
  })
  it('pool limit error releases the half-open probe', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    const hl = h.gw.healthFor(up)
    const spy = vi.spyOn(hl.breaker, 'cancelProbe')
    h.store.limits.set('A', { maxConnections: 0 })
    await h.gw.pool.invalidate('A', up.id)
    const r = await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })
    expect(r.isError).toBe(true)
    expect(spy).toHaveBeenCalled()
  })
  it('tools/list cache hits neither report success nor consume the breaker', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx) // fills the cache
    const hl = h.gw.healthFor(up)
    const allow = vi.spyOn(hl.breaker, 'allow')
    const ok = vi.spyOn(hl, 'success')
    for (let i = 0; i < 3; i++) await h.gw.toolSource.listTools(ctx)
    expect(allow).not.toHaveBeenCalled()
    expect(ok).not.toHaveBeenCalled()
  })
})

describe('stdio connect cleanup (M4)', () => {
  it('abort during stdio connect closes the transport (no leaked child)', async () => {
    const closed = vi.fn(async () => {})
    const transport = { start: () => new Promise<void>(() => {}), send: async () => {}, close: closed }
    const up = { id: 'i', userId: 'A', slug: 's', type: 'stdio', command: 'x', args: [], env: {}, timeouts: null, authType: 'none' } as unknown as UpstreamRow
    const ac = new AbortController()
    const p = connectUpstream(up, { safeFetch: (async () => new Response()) as never, credentials: async () => ({ headers: {}, env: {} }), stdioTransport: async () => transport as never }, ac.signal)
    setTimeout(() => ac.abort(), 50)
    await expect(p).rejects.toBeDefined()
    expect(closed).toHaveBeenCalled()
  })
})

describe('stats timer (M7) and stop (L1)', () => {
  it('createGateway starts the timed flush', () => {
    h = makeGateway()
    expect((h.gw.stats as unknown as { timer: unknown }).timer).not.toBeNull()
  })
  it('stop() waits for an in-flight flush instead of counting it as dropped', async () => {
    const written: number[] = []
    const row = { ts: new Date(), userId: 'u', clientId: null, tokenId: null, upstreamId: null, upstreamSlug: 's', tool: null, kind: 'call', status: 'ok', totalMs: 1, upstreamMs: null, overheadMs: null, retries: 0, reqBytes: 0, resBytes: 0, cacheHit: false } as CallStatRow
    const b = new StatsBuffer({ write: async (r) => { await new Promise(res => setTimeout(res, 150)); written.push(r.length) } })
    b.push(row)
    void b.flush()
    await new Promise(r => setTimeout(r, 10))
    await b.stop()
    expect(written).toEqual([1])
    expect(b.dropped).toBe(0)
  })
})

describe('limiter (L7)', () => {
  it('forgetUser matches whole ids and drops token buckets', () => {
    const l = new Limiter()
    const input = (userId: string, tokenId: string) => ({ userId, tokenId, upstreamId: `up-${userId}`, userPerMin: 1, ratePerMin: 60, maxConcurrent: 5 })
    for (const u of ['ab', 'abc']) { const r = l.acquire(input(u, `tok-${u}`)); expect(r.ok).toBe(true); if (r.ok) r.release() }
    l.forgetUser('ab')
    const keys = [...(l as unknown as { buckets: Map<string, unknown> }).buckets.keys()]
    expect(keys.some(k => k.includes('abc'))).toBe(true) // abc stays
    expect(keys.some(k => /(^|:)ab(:|$)/.test(k))).toBe(false)
    expect(l.acquire(input('abc', 'tok-abc')).ok).toBe(false) // abc keeps its empty quota
  })
  it('a 429 with Retry-After blocks that upstream (and only it)', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url })
    const other = h.store.addUpstream('A', { slug: 'two', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    a.state.mode = 'retry429'
    const r1 = await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })
    expect(r1.isError).toBe(true)
    expect(h.gw.limiter.upstreamBlockedUntil(up.id)).not.toBeNull()
    expect(h.gw.limiter.upstreamBlockedUntil(other.id)).toBeNull()
    a.state.mode = 'ok'
    const r2 = await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })
    expect(r2).toMatchObject({ isError: true, _meta: { code: 'rate_limited' } })
  })
})

describe('ipc transport errors after start (L8)', () => {
  it('error frames after a successful start reach onerror', async () => {
    let handler: ((m: unknown) => void) | undefined
    const session = { register: (_id: string, f: (m: unknown) => void) => { handler = f }, send: () => {}, unregister: () => {} }
    const t = new IpcTransport(session as never, { command: 'x', args: [], env: {} })
    const errors: Error[] = []
    t.onerror = e => errors.push(e)
    const started = t.start()
    handler!({ t: 'started' })
    await started
    handler!({ t: 'error', code: 'oops', message: 'late failure' })
    expect(errors.map(e => e.message)).toEqual(['late failure'])
  })
})

describe('secret AAD framing (L10)', () => {
  it('field boundaries cannot be shifted', () => {
    const key = randomBytes(32)
    const ct = encryptSecret(key, 'u', { upstreamId: 'i', kind: 'a|b', name: 'c' }, 'secret')
    expect(decryptSecret(key, 'u', { upstreamId: 'i', kind: 'a|b', name: 'c' }, ct)).toBe('secret')
    expect(() => decryptSecret(key, 'u', { upstreamId: 'i', kind: 'a', name: 'b|c' }, ct)).toThrow()
    expect(() => decryptSecret(key, 'u|i', { upstreamId: 'a|b', kind: 'c', name: 'd' }, encryptSecret(key, 'u', { upstreamId: 'i|a|b', kind: 'c', name: 'd' }, 'x'))).toThrow()
  })
})
