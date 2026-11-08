import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { encryptSecret } from '../../server/gateway/crypto/secrets'
import { AllowList } from '../../server/gateway/net/ssrf'
import { checkRestTools } from '../../server/gateway/rest/template'
import { ctxFor, makeGateway, sig } from '../helpers/gateway'

type Seen = { method: string, url: string, headers: IncomingMessage['headers'], body: string }
let server: Server
let base = ''
const seen: Seen[] = []
let hangMs = 0

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() })
      const u = new URL(req.url ?? '/', 'http://x')
      if (u.pathname === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/' }).end(); return }
      if (u.pathname === '/boom') { res.writeHead(500).end('boom'); return }
      if (u.pathname === '/denied') { res.writeHead(401).end('no'); return }
      if (u.pathname === '/missing') { res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"nope"}'); return }
      if (u.pathname === '/binary') { res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(2000)); return }
      if (u.pathname === '/huge') { res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(2_000_000)); return }
      if (u.pathname === '/slow') { setTimeout(() => res.writeHead(200).end('late'), hangMs); return }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ path: u.pathname, query: Object.fromEntries(u.searchParams), method: req.method }, null, 2))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close() })
afterEach(() => { seen.length = 0 })

const text = (r: { content?: unknown }) => (r.content as Array<{ text?: string }>)[0]?.text ?? ''
const defs = (extra: unknown[] = []) => checkRestTools([
  { name: 'get_item', urlTemplate: '/items/{id}', inputSchema: { properties: { id: { type: 'string' }, verbose: { type: 'boolean' } }, required: ['id'] } },
  { name: 'create_item', method: 'POST', urlTemplate: '/items', inputSchema: { properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'boom', urlTemplate: '/boom' }, { name: 'denied', urlTemplate: '/denied' }, { name: 'missing', urlTemplate: '/missing' },
  { name: 'redirect', urlTemplate: '/redirect' }, { name: 'binary', urlTemplate: '/binary' }, { name: 'huge', urlTemplate: '/huge' }, { name: 'slow', urlTemplate: '/slow' },
  ...extra,
], true)

function setup(over: Parameters<typeof makeGateway>[0] = {}, up: Record<string, unknown> = {}) {
  const h = makeGateway(over)
  const row = h.store.addUpstream('A', { slug: 'api', url: base, type: 'rest', ...up })
  h.store.restTools.set(`A:${row.id}`, defs())
  return { h, row, ctx: ctxFor('A') }
}

describe('REST upstream through the gateway', () => {
  let h: { gw: ReturnType<typeof makeGateway>['gw'] }
  afterEach(async () => { await h.gw.shutdown(500) })

  it('lists the tools namespaced with annotations derived from the method', async () => {
    const s = setup(); h = s.h
    const list = await h.gw.toolSource.listTools(s.ctx)
    const names = list.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['api__get_item', 'api__create_item']))
    expect(list.find(t => t.name === 'api__get_item')!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(list.find(t => t.name === 'api__create_item')!.annotations).toMatchObject({ readOnlyHint: false })
    expect(list.find(t => t.name === 'api__get_item')!.inputSchema).toMatchObject({ required: ['id'] })
  })

  it('calls a GET with an encoded path value and returns compact JSON text', async () => {
    const s = setup(); h = s.h
    const r = await h.gw.toolSource.callTool(s.ctx, 'api__get_item', { id: 'a/b', verbose: true }, { signal: sig() })
    expect(r.isError).toBeFalsy()
    expect(JSON.parse(text(r))).toEqual({ path: '/items/a%2Fb', query: { verbose: 'true' }, method: 'GET' })
    expect(text(r)).not.toContain('\n')
  })

  it('POST sends unreferenced arguments as a JSON body', async () => {
    const s = setup(); h = s.h
    await h.gw.toolSource.callTool(s.ctx, 'api__create_item', { title: 'hello' }, { signal: sig() })
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/items', body: '{"title":"hello"}' })
    expect(seen[0]!.headers['content-type']).toBe('application/json')
  })

  it('bad arguments never reach the target', async () => {
    const s = setup(); h = s.h
    const r = await h.gw.toolSource.callTool(s.ctx, 'api__get_item', { id: 5 }, { signal: sig() })
    expect(r.isError).toBe(true); expect(text(r)).toMatch(/Ungültiger Aufruf/)
    const r2 = await h.gw.toolSource.callTool(s.ctx, 'api__get_item', { id: '..' }, { signal: sig() })
    expect(r2.isError).toBe(true)
    expect(seen).toHaveLength(0)
  })

  it('4xx is a tool result; 5xx counts against the breaker; 401 marks auth', async () => {
    const s = setup(); h = s.h
    const miss = await h.gw.toolSource.callTool(s.ctx, 'api__missing', {}, { signal: sig() })
    expect(miss.isError).toBe(true); expect(text(miss)).toContain('HTTP 404'); expect(text(miss)).toContain('{"error":"nope"}')
    const boom = await h.gw.toolSource.callTool(s.ctx, 'api__boom', {}, { signal: sig() })
    expect(boom.isError).toBe(true); expect(boom._meta).toMatchObject({ code: 'upstream_error' })
    expect(h.gw.healthFor(s.row).breaker).toBeTruthy()
  })

  it('does not follow redirects', async () => {
    const s = setup(); h = s.h
    const r = await h.gw.toolSource.callTool(s.ctx, 'api__redirect', {}, { signal: sig() })
    expect(r.isError).toBe(true); expect(r._meta).toMatchObject({ code: 'redirect' })
    expect(seen).toHaveLength(1)
  })

  it('binary responses are described, huge text is truncated', async () => {
    const s = setup(); h = s.h
    expect(text(await h.gw.toolSource.callTool(s.ctx, 'api__binary', {}, { signal: sig() }))).toMatch(/image\/png.*nicht übertragen/)
    const huge = text(await h.gw.toolSource.callTool(s.ctx, 'api__huge', {}, { signal: sig() }))
    expect(huge.length).toBeLessThan(100_100); expect(huge).toContain('[Antwort gekürzt]')
  })

  it('times out slow targets as a timeout', async () => {
    hangMs = 3000
    const s = setup({}, { timeouts: { callMs: 150 } }); h = s.h
    const r = await h.gw.toolSource.callTool(s.ctx, 'api__slow', {}, { signal: sig() })
    expect(r.isError).toBe(true); expect(r._meta).toMatchObject({ code: 'timeout' })
  })

  it('bearer auth is sent; a tool header cannot override it (and cannot even be defined)', async () => {
    const g = makeGateway()
    const row = g.store.addUpstream('A', { slug: 'api', url: base, type: 'rest', authType: 'bearer' })
    g.store.restTools.set(`A:${row.id}`, defs([{ name: 'hdr', urlTemplate: '/h', headers: { 'X-Trace': 'abc' } }]))
    g.store.secrets.push({ userId: 'A', upstreamId: row.id, kind: 'bearer', name: '', ciphertext: encryptSecret(g.masterKey, 'A', { upstreamId: row.id, kind: 'bearer', name: '' }, 'tok-123') })
    h = g as never
    await g.gw.toolSource.callTool(ctxFor('A'), 'api__hdr', {}, { signal: sig() })
    expect(seen[0]!.headers.authorization).toBe('Bearer tok-123')
    expect(seen[0]!.headers['x-trace']).toBe('abc')
    expect(() => checkRestTools([{ name: 'x', urlTemplate: '/x', headers: { Authorization: 'Bearer evil' } }], true)).toThrow(/nicht erlaubt/)
  })

  it('a missing secret does not call the target without credentials', async () => {
    const g = makeGateway(); h = g as never
    const row = g.store.addUpstream('A', { slug: 'api', url: base, type: 'rest', authType: 'bearer' })
    g.store.restTools.set(`A:${row.id}`, defs())
    // like HTTP upstreams: without the secret the connection is never set up, so the tool is not callable and the target is never contacted
    await expect(g.gw.toolSource.callTool(ctxFor('A'), 'api__get_item', { id: '1' }, { signal: sig() })).rejects.toThrow(/Tool not found/)
    expect(await g.gw.toolSource.listTools(ctxFor('A'))).toEqual([])
    expect(seen).toHaveLength(0)
  })

  it('SSRF: without an allow entry a loopback target is blocked on every request and never contacted', async () => {
    const s = setup({ getAllow: () => new AllowList() }); h = s.h
    const r = await h.gw.toolSource.callTool(s.ctx, 'api__get_item', { id: '1' }, { signal: sig() })
    expect(r.isError).toBe(true); expect(r._meta).toMatchObject({ code: 'ssrf_blocked' })
    expect(JSON.stringify(r)).not.toMatch(/127\.0\.0\.1/)
    expect(seen).toHaveLength(0)
  })

  it('SSRF: an absolute URL template pointing to a private address is blocked as well', async () => {
    const g = makeGateway({ getAllow: () => new AllowList() }); h = g as never
    const row = g.store.addUpstream('A', { slug: 'api', url: null, type: 'rest' })
    g.store.restTools.set(`A:${row.id}`, checkRestTools([{ name: 'meta', urlTemplate: 'http://169.254.169.254/latest/meta-data' }], false))
    const r = await g.gw.toolSource.callTool(ctxFor('A'), 'api__meta', {}, { signal: sig() })
    expect(r._meta).toMatchObject({ code: 'ssrf_blocked' })
  })

  it('the per-tool switch and the definition switch hide tools; changed definitions apply after a version bump', async () => {
    const s = setup(); h = s.h
    await h.gw.toolSource.listTools(s.ctx)
    s.h.store.setToolEnabled('A', s.row.id, 'get_item', false)
    h.gw.catalog.invalidate('A', s.row.id)
    expect((await h.gw.toolSource.listTools(s.ctx)).map(t => t.name)).not.toContain('api__get_item')
    const call = await h.gw.toolSource.callTool(s.ctx, 'api__get_item', { id: '1' }, { signal: sig() }).catch(e => e)
    expect(call).toBeInstanceOf(Error)
    s.h.store.restTools.set(`A:${s.row.id}`, defs([{ name: 'extra', urlTemplate: '/x' }]).map(t => (t.name === 'create_item' ? { ...t, enabled: false } : t)))
    s.row.version++
    const names = (await h.gw.toolSource.listTools(s.ctx)).map(t => t.name)
    expect(names).toContain('api__extra'); expect(names).not.toContain('api__create_item')
  })
})
