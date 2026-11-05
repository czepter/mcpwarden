import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { ctxFor, makeGateway, sig } from '../helpers/gateway'

let a: FakeHttp, b: FakeHttp
beforeAll(async () => { a = await startFakeHttp(); b = await startFakeHttp() })
afterAll(async () => { await a.close(); await b.close() })
afterEach(() => { a.state.mode = 'ok'; b.state.mode = 'ok'; a.state.calls = {}; a.state.aborted = 0 })
let h: ReturnType<typeof makeGateway>
afterEach(async () => { await h?.gw.shutdown(300) })
const waitFor = async (fn: () => boolean, ms = 3000) => { const t = Date.now(); while (!fn() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 20)); return fn() }

describe('resilience', () => {
  it('call timeout: error after deadline, upstream sees the connection abort, NO second call of a non-idempotent tool', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'one', url: a.url, timeouts: { callMs: 400 } })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    a.state.mode = 'hang'
    const t = Date.now()
    const r = await h.gw.toolSource.callTool(ctx, 'one__create_order', {}, { signal: sig() })
    expect(Date.now() - t).toBeLessThan(1500)
    expect(r).toMatchObject({ isError: true, _meta: { code: 'timeout' } })
    expect(a.state.calls.create_order).toBe(1)
    expect(await waitFor(() => a.state.aborted >= 1)).toBe(true) // HTTP-2026: stream closed = abort
    await new Promise(r => setTimeout(r, 300))
    expect(a.state.calls.create_order).toBe(1)
  })

  it('client abort (signal) cancels the upstream call', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    a.state.mode = 'hang'
    const ac = new AbortController()
    const p = h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: ac.signal })
    await waitFor(() => (a.state.calls.echo ?? 0) === 1)
    ac.abort()
    const r = await p
    expect(r.isError).toBe(true)
    expect(await waitFor(() => a.state.aborted >= 1)).toBe(true)
    expect(a.state.calls.echo).toBe(1)
  })

  it('HTTP 500 on a call: no retry (no double invocation), counts as failure -> degraded', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    a.state.mode = 'status500'
    const before = a.state.requests.length
    const r = await h.gw.toolSource.callTool(ctx, 'one__create_order', {}, { signal: sig() })
    expect(r.isError).toBe(true)
    expect(a.state.requests.length - before).toBe(1)
    expect(a.state.calls.create_order ?? 0).toBe(0)
    expect(h.gw.healthFor(up).status).toBe('degraded')
  })

  it('breaker opens after 5 consecutive failures, fails fast, half-open probe closes it', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url, ratePerMin: 1000, timeouts: { callMs: 300 } })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    a.state.mode = 'status500'
    for (let i = 0; i < 5; i++) await h.gw.toolSource.callTool(ctx, 'one__add', { a: 1, b: 1 }, { signal: sig() })
    const hl = h.gw.healthFor(up)
    expect(hl.status).toBe('open')
    const n = a.state.requests.length
    const r = await h.gw.toolSource.callTool(ctx, 'one__add', { a: 1, b: 1 }, { signal: sig() })
    expect(r._meta).toMatchObject({ code: 'breaker_open' })
    expect(a.state.requests.length).toBe(n) // no request
    expect(hl.snapshot().nextRetryAt).toBeGreaterThan(Date.now())
    expect(h.statuses.map(s => s.s.status)).toEqual(['healthy', 'degraded', 'open'])
    // Fast-forward time: the breaker clock is Date.now -> we set the state directly via probe
    a.state.mode = 'ok'
    ;(hl.breaker as unknown as { openUntil: number }).openUntil = Date.now() - 1
    const ok = await h.gw.toolSource.callTool(ctx, 'one__add', { a: 1, b: 1 }, { signal: sig() })
    expect(ok.isError).toBeFalsy()
    expect(hl.status).toBe('healthy')
  })

  it('isError tool results do not count towards the breaker', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url, ratePerMin: 1000 })
    const ctx = ctxFor('A')
    for (let i = 0; i < 8; i++) await h.gw.toolSource.callTool(ctx, 'one__fail', {}, { signal: sig() })
    expect(h.gw.healthFor(up).status).toBe('healthy')
  })

  it('a hanging upstream does not block tools/list of others and stays below the deadline', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'hang', url: b.url, timeouts: { connectMs: 400, listMs: 400 }, transport: 'streamable' })
    h.store.addUpstream('A', { slug: 'ok', url: a.url })
    b.state.mode = 'hang-http'
    const t = Date.now()
    const names = (await h.gw.toolSource.listTools(ctxFor('A'))).map(x => x.name)
    expect(Date.now() - t).toBeLessThan(5000)
    expect(names).toContain('ok__echo')
    expect(names.some(n => n.startsWith('hang__'))).toBe(false)
  })

  it('hanging upstream A does not consume concurrency of B', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'sa', url: a.url, maxConcurrent: 1, timeouts: { callMs: 2000 } })
    h.store.addUpstream('A', { slug: 'sb', url: b.url, maxConcurrent: 1 })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    a.state.mode = 'hang'
    const pa = h.gw.toolSource.callTool(ctx, 'sa__echo', { text: 'x' }, { signal: sig() })
    await waitFor(() => (a.state.calls.echo ?? 0) === 1)
    const second = await h.gw.toolSource.callTool(ctx, 'sa__echo', { text: 'x' }, { signal: sig() })
    expect(second._meta).toMatchObject({ code: 'rate_limited' })
    const rb = await h.gw.toolSource.callTool(ctx, 'sb__echo', { text: 'ok' }, { signal: sig() })
    expect(rb.isError).toBeFalsy()
    a.state.mode = 'ok'
    await h.gw.core.drain(100)
    await pa
  })

  it('shutdown drains: new calls refused, running call finishes', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    a.state.slowMs = 300
    const running = h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'slow' }, { signal: sig() })
    await waitFor(() => (a.state.calls.echo ?? 0) === 1)
    const drain = h.gw.core.drain(3000)
    expect((await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() }))._meta).toMatchObject({ code: 'draining' })
    expect((await running).isError).toBeFalsy()
    await drain
    a.state.slowMs = 0
  })

  it('no leaked sockets after shutdown', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'one', url: a.url })
    await h.gw.toolSource.listTools(ctxFor('A'))
    await h.gw.shutdown(200)
    expect(await waitFor(() => a.openSockets() === 0)).toBe(true)
  })
})
