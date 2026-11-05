import { describe, expect, it } from 'vitest'
import { Breaker } from '../../server/gateway/upstream/breaker'
import { UpstreamHealth, type StatusSnapshot } from '../../server/gateway/upstream/status'

describe('breaker', () => {
  it('closed -> open after 5 -> half-open (one probe) -> closed', () => {
    let t = 0
    const b = new Breaker(() => t)
    for (let i = 0; i < 4; i++) b.failure()
    expect(b.state).toBe('closed')
    b.failure()
    expect(b.state).toBe('open')
    expect(b.nextRetryAt).toBe(30_000)
    expect(b.allow()).toBe(false)
    t = 30_000
    expect(b.allow()).toBe(true)
    expect(b.state).toBe('half-open')
    expect(b.allow()).toBe(false) // nur ein Probeaufruf
    b.success()
    expect(b.state).toBe('closed')
  })
  it('failed probe doubles open time up to 5 min', () => {
    let t = 0
    const b = new Breaker(() => t)
    const open = () => { for (let i = 0; i < 5; i++) b.failure() }
    open()
    const waits: number[] = []
    for (let c = 0; c < 6; c++) {
      waits.push(b.nextRetryAt! - t)
      t = b.nextRetryAt!
      expect(b.allow()).toBe(true)
      b.failure()
    }
    expect(waits).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000])
  })
  it('success resets consecutive count', () => {
    const b = new Breaker(() => 0)
    for (let i = 0; i < 4; i++) b.failure()
    b.success()
    for (let i = 0; i < 4; i++) b.failure()
    expect(b.state).toBe('closed')
  })
})

describe('status model', () => {
  const mk = (cfg = { enabled: true, setup: 'ready' as const }) => {
    const events: Array<[string, StatusSnapshot]> = []
    const h = new UpstreamHealth('u', 'up', cfg, { onChange: (_i, _u, s, prev) => { events.push([prev, s]) } }, () => 0)
    return { h, events }
  }
  it('unknown -> healthy -> degraded (1-4) -> open (5) -> healthy; writes only on change', () => {
    const { h, events } = mk()
    h.success(); h.success()
    expect(events.map(e => e[1].status)).toEqual(['healthy'])
    h.failure('timeout')
    expect(h.status).toBe('degraded')
    expect(h.snapshot().reason).toContain('1 Fehler in Folge')
    for (let i = 0; i < 4; i++) h.failure('http5xx')
    expect(h.status).toBe('open')
    expect(h.snapshot().nextRetryAt).toBe(30_000)
    h.success()
    expect(h.status).toBe('healthy')
    expect(events.map(e => e[1].status)).toEqual(['healthy', 'degraded', 'open', 'healthy'])
  })
  it('auth failure -> auth_expired, not counted for the breaker', () => {
    const { h } = mk()
    h.failure('auth')
    expect(h.status).toBe('auth_expired')
    expect(h.breaker.consecutiveFailures).toBe(0)
    h.success()
    expect(h.status).toBe('healthy')
  })
  it('setup axis keeps status unknown; disabled wins', () => {
    const { h } = mk({ enabled: true, setup: 'awaiting_auth' })
    h.failure('connect')
    expect(h.snapshot().status).toBe('unknown')
    h.configure({ enabled: false, setup: 'ready' })
    expect(h.status).toBe('disabled')
  })
})
