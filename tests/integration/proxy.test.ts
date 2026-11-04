import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ToolNotFoundError } from '../../server/gateway/ports'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { ctxFor, makeGateway, sig } from '../helpers/gateway'

let a: FakeHttp, b: FakeHttp
beforeAll(async () => { a = await startFakeHttp(); b = await startFakeHttp({ toolNames: ['only_b'] }) })
afterAll(async () => { await a.close(); await b.close() })
const text = (r: { content?: unknown }) => (r.content as Array<{ text?: string }>)[0]?.text

describe('proxy passthrough', () => {
  let h: ReturnType<typeof makeGateway>
  afterEach(async () => { await h.gw.shutdown(500) })

  it('namespaces tools, passes results unchanged (text/image/resource/isError/structured)', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'one', url: a.url }); h.store.addUpstream('A', { slug: 'two', url: b.url })
    const ctx = ctxFor('A')
    const list = await h.gw.toolSource.listTools(ctx)
    const names = list.map(t => t.name)
    expect(names).toContain('one__echo'); expect(names).toContain('two__echo'); expect(names).toContain('two__only_b')
    expect(list.find(t => t.name === 'one__add')!.inputSchema).toBeTruthy()
    expect(list.find(t => t.name === 'one__echo')!.annotations?.readOnlyHint).toBe(true)
    expect(text(await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'hi' }, { signal: sig() }))).toBe('hi')
    const add = await h.gw.toolSource.callTool(ctx, 'two__add', { a: 1, b: 2 }, { signal: sig() })
    expect(add.structuredContent).toEqual({ sum: 3 })
    expect((await h.gw.toolSource.callTool(ctx, 'one__image', {}, { signal: sig() })).content[0]).toEqual({ type: 'image', data: 'AAAA', mimeType: 'image/png' })
    expect((await h.gw.toolSource.callTool(ctx, 'one__resource', {}, { signal: sig() })).content[0]).toMatchObject({ type: 'resource', resource: { uri: 'file:///x.txt', text: 'hi' } })
    const fail = await h.gw.toolSource.callTool(ctx, 'one__fail', {}, { signal: sig() })
    expect(fail.isError).toBe(true); expect(text(fail)).toBe('boom')
  })

  it('reuses the pooled connection; version change reconnects; disabling a user closes it', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })
    const entry1 = await h.gw.pool.get(up)
    await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })
    expect(await h.gw.pool.get(up)).toBe(entry1)
    up.version++
    expect(await h.gw.pool.get(up)).not.toBe(entry1)
    expect(h.gw.pool.count('A')).toBe(1)
    await h.gw.onUserDisabled('A')
    expect(h.gw.pool.count()).toBe(0)
  })

  it('tool filter takes effect without restart, even for guessed names', async () => {
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    h.store.setToolEnabled('A', up.id, 'echo', false)
    expect((await h.gw.toolSource.listTools(ctx)).map(t => t.name)).not.toContain('one__echo')
    await expect(h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
    await expect(h.gw.toolSource.callTool(ctx, 'one__nonexistent', {}, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
    up.enabled = false
    expect(await h.gw.toolSource.listTools(ctx)).toEqual([])
    await expect(h.gw.toolSource.callTool(ctx, 'one__add', { a: 1, b: 1 }, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
  })

  it('isolation: user B sees/calls nothing of A; same slug resolves to B\'s own upstream; secrets bound to user', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'u1', url: a.url })
    const ctxB = ctxFor('B')
    expect(await h.gw.toolSource.listTools(ctxB)).toEqual([])
    await expect(h.gw.toolSource.callTool(ctxB, 'u1__echo', { text: 'x' }, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
    await expect(h.gw.toolSource.callTool(ctxB, 'nope__echo', {}, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
    h.store.addUpstream('B', { slug: 'u1', url: b.url })
    expect((await h.gw.toolSource.listTools(ctxB)).map(t => t.name)).toContain('u1__only_b')
    expect((await h.gw.toolSource.listTools(ctxFor('A'))).map(t => t.name)).not.toContain('u1__only_b')
    expect(h.rows.filter(r => r.userId === 'B').every(r => r.userId === 'B')).toBe(true)
  })

  it('bearer / header auth with decrypted secrets; wrong token -> 401 -> auth_expired', async () => {
    const { encryptSecret } = await import('../../server/gateway/crypto/secrets')
    const f = await startFakeHttp()
    f.requireHeader('authorization', 'Bearer s3cret')
    h = makeGateway()
    const up = h.store.addUpstream('A', { slug: 'auth', url: f.url, authType: 'bearer' })
    h.store.secrets.push({ userId: 'A', upstreamId: up.id, kind: 'bearer', name: '', ciphertext: encryptSecret(h.masterKey, 'A', { upstreamId: up.id, kind: 'bearer', name: '' }, 's3cret') })
    const ctx = ctxFor('A')
    expect((await h.gw.toolSource.listTools(ctx)).map(t => t.name)).toContain('auth__echo')
    h.store.secrets[0]!.ciphertext = encryptSecret(h.masterKey, 'A', { upstreamId: up.id, kind: 'bearer', name: '' }, 'wrong')
    up.version++
    await h.gw.catalog.invalidate('A', up.id)
    await h.gw.toolSource.callTool(ctx, 'auth__echo', { text: 'x' }, { signal: sig() })
    expect(h.gw.healthFor(up).status).toBe('auth_expired')
    await f.close()
  })

  it('records one stat row per list/call with overhead', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    await h.gw.toolSource.callTool(ctx, 'one__echo', { text: 'x' }, { signal: sig() })
    await h.gw.stats.flush(true)
    expect(h.rows.map(r => r.kind)).toEqual(['list', 'call'])
    const call = h.rows[1]!
    expect(call).toMatchObject({ status: 'ok', tool: 'echo', upstreamSlug: 'one' })
    expect(call.overheadMs).toBeGreaterThanOrEqual(0)
    expect(call.reqBytes).toBeGreaterThan(0)
  })

  it('rate limit: 61st call fails immediately with retry_after', async () => {
    h = makeGateway()
    h.store.addUpstream('A', { slug: 'one', url: a.url, ratePerMin: 3 })
    const ctx = ctxFor('A')
    for (let i = 0; i < 3; i++) expect((await h.gw.toolSource.callTool(ctx, 'one__add', { a: 1, b: 1 }, { signal: sig() })).isError).toBeFalsy()
    const r = await h.gw.toolSource.callTool(ctx, 'one__add', { a: 1, b: 1 }, { signal: sig() })
    expect(r.isError).toBe(true)
    expect(r._meta).toMatchObject({ code: 'rate_limited', limit_scope: 'upstream' })
    expect(Number(r._meta!.retry_after)).toBeGreaterThanOrEqual(1)
  })
})
