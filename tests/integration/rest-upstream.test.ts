// REST upstreams against the built artifact: create/patch/read with tool definitions, validation, the connection test,
// and the full path through /mcp (tools/list, tools/call) against a local REST target (allowed via the admin exception list).
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PatCreated, RestToolList, UpstreamDetail, UpstreamList, UpstreamTestResult, UpstreamToolList } from '#shared/api-types'
import { schemas } from '../contract/schemas'
import { createInstance, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let target: Server
let base = ''
let admin: ApiClient
let pat: PatCreated
const hits: Array<{ method: string, url: string, body: string, auth?: string }> = []

const text = (r: { content: unknown }) => (r.content as Array<{ text: string }>)[0]!.text
async function mcp() {
  const c = new Client({ name: 't', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${pat.token}` } } }))
  return c
}
const tools = [
  { name: 'get_item', description: 'Ein Item abrufen', urlTemplate: '/items/{id}', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_item', method: 'POST', urlTemplate: '/items', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'health', urlTemplate: '/health' },
]

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  target = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      hits.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString(), auth: req.headers.authorization })
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, url: req.url }))
    })
  })
  await new Promise<void>(r => target.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(target.address() as AddressInfo).port}/api`
  admin = await signUpFirstAdmin(srv)
  expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })).status).toBe(200)
  pat = (await admin.request('/api/me/pats', { body: { name: 'rest' } })).json
})
afterAll(async () => { await srv.stop(); target.closeAllConnections(); target.close(); await inst.cleanup() })

describe('REST upstream API', () => {
  let up: UpstreamDetail

  it('rejects bad definitions with 422 and a field', async () => {
    const mk = (restTools: unknown, extra: Record<string, unknown> = {}) => admin.request('/api/upstreams', { body: { name: 'R', slug: 'bad', type: 'rest', url: base, restTools, ...extra } })
    for (const [restTools, field] of [
      [[{ name: 'a b', urlTemplate: '/x' }], 'name'],
      [[{ name: 'a', urlTemplate: '/x/{nope}' }], 'inputSchema'],
      [[{ name: 'a', urlTemplate: 'https://{h}/x', inputSchema: { properties: { h: { type: 'string' } }, required: ['h'] } }], 'urlTemplate'],
      [[{ name: 'a', urlTemplate: '/x', headers: { Authorization: 'x' } }], 'headers'],
      [[{ name: 'a', urlTemplate: '/x' }, { name: 'a', urlTemplate: '/y' }], 'restTools'],
    ] as const) {
      const r = await mk(restTools)
      expect(r.status, JSON.stringify(restTools)).toBe(422)
      expect(r.json.data.field).toBe(field)
    }
    expect((await mk([{ name: 'a', urlTemplate: '/x' }], { url: undefined })).status).toBe(422) // relative path without a base URL
    expect((await mk([], { authType: 'oauth' })).status).toBe(422)
    expect((await mk([], { command: 'npx' })).status).toBe(422)
    expect((await admin.request('/api/upstreams', { body: { name: 'H', slug: 'httpx', type: 'http', url: base, restTools: [] } })).status).toBe(422)
  })

  it('creates a REST upstream with tools; detail carries them, the list does not; contract holds', async () => {
    const r = await admin.request('/api/upstreams', { body: { name: 'Items', slug: 'items', type: 'rest', url: base, restTools: tools } })
    expect(r.status, r.text).toBe(201)
    up = r.json
    expect(up).toMatchObject({ type: 'rest', setup: 'ready', url: base, toolsTotal: 3 })
    expect(up.restTools!.map(t => t.name).sort()).toEqual(['create_item', 'get_item', 'health'])
    expect(schemas.upstreamDetail.safeParse(up).success).toBe(true)
    const list = (await admin.request('/api/upstreams')).json as UpstreamList
    expect(list.items.find(u => u.slug === 'items')).not.toHaveProperty('restTools')
    expect(schemas.restToolList.safeParse((await admin.request(`/api/upstreams/${up.id}/rest-tools`)).json).success).toBe(true)
  })

  it('connection test calls a safe GET tool for real and lists the tools', async () => {
    hits.length = 0
    const t = (await admin.request(`/api/upstreams/${up.id}/test`, { method: 'POST' })).json as UpstreamTestResult
    expect(t.ok).toBe(true)
    if (t.ok) expect(t.tools.map(x => x.name).sort()).toEqual(['create_item', 'get_item', 'health'])
    expect(hits.map(h => h.url)).toContain('/api/health')
  })

  it('serves the tools through /mcp, namespaced, and calls them against the target', async () => {
    const c = await mcp()
    const list = await c.listTools()
    expect(list.tools.map(x => x.name)).toEqual(expect.arrayContaining(['items__get_item', 'items__create_item', 'items__health']))
    expect(list.tools.find(x => x.name === 'items__get_item')!.inputSchema).toMatchObject({ required: ['id'] })
    hits.length = 0
    const got = await c.callTool({ name: 'items__get_item', arguments: { id: 'a/b' } })
    expect(JSON.parse(text(got as never))).toEqual({ ok: true, url: '/api/items/a%2Fb' })
    await c.callTool({ name: 'items__create_item', arguments: { title: 'hello' } })
    expect(hits.at(-1)).toMatchObject({ method: 'POST', url: '/api/items', body: '{"title":"hello"}' })
    const bad = await c.callTool({ name: 'items__get_item', arguments: { id: '..' } })
    expect(bad.isError).toBe(true)
    await c.close()
  })

  it('bearer auth: the secret is sent to the target and never returned', async () => {
    const r = await admin.request('/api/upstreams', { body: { name: 'Secured', slug: 'secured', type: 'rest', url: base, authType: 'bearer', restTools: [{ name: 'whoami', urlTemplate: '/whoami' }] } })
    expect(r.status).toBe(201)
    expect(r.json.setup).toBe('awaiting_auth')
    expect((await admin.request(`/api/upstreams/${r.json.id}/secret`, { method: 'PUT', body: { kind: 'bearer', value: 'canary-secret-123' } })).status).toBe(200)
    hits.length = 0
    const c = await mcp()
    await c.callTool({ name: 'secured__whoami', arguments: {} })
    await c.close()
    expect(hits.at(-1)!.auth).toBe('Bearer canary-secret-123')
    expect(JSON.stringify((await admin.request(`/api/upstreams/${r.json.id}`)).json)).not.toContain('canary-secret-123')
  })

  it('replacing the tools takes effect for clients; per-tool switch still applies', async () => {
    const put = await admin.request(`/api/upstreams/${up.id}/rest-tools`, { method: 'PUT', body: { items: [tools[0], { name: 'extra', urlTemplate: '/extra' }] } })
    expect(put.status, put.text).toBe(200)
    expect((put.json as RestToolList).items.map(t => t.name)).toEqual(['extra', 'get_item'])
    expect((await admin.request(`/api/upstreams/${up.id}/tools/get_item`, { method: 'PUT', body: { enabled: false } })).status).toBe(200)
    const c = await mcp()
    const names = (await c.listTools()).tools.map(x => x.name)
    expect(names).toContain('items__extra')
    expect(names).not.toContain('items__get_item')
    expect(names).not.toContain('items__create_item')
    await c.close()
    const tl = (await admin.request(`/api/upstreams/${up.id}/tools`)).json as UpstreamToolList
    expect(tl.items.find(t => t.name === 'create_item')?.gone).toBe(true)
  })

  it('patch with restTools replaces the set; REST tools of other types are refused', async () => {
    const p = await admin.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { restTools: [{ name: 'only', urlTemplate: '/only' }] } })
    expect(p.status, p.text).toBe(200)
    expect((p.json as UpstreamDetail).restTools!.map(t => t.name)).toEqual(['only'])
    const http = (await admin.request('/api/upstreams', { body: { name: 'H', slug: 'plain', type: 'http', url: base } })).json as UpstreamDetail
    expect((await admin.request(`/api/upstreams/${http.id}/rest-tools`)).status).toBe(422)
    expect((await admin.request(`/api/upstreams/${http.id}`, { method: 'PATCH', body: { restTools: [] } })).status).toBe(422)
  })

  it('SSRF: with no exception a loopback target is refused on create (absolute template) and never called', async () => {
    expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': [] } })).status).toBe(200)
    // the settings cache lives up to 10 s; a precheck of literal addresses reads it, so try until the new list is seen
    let status = 0
    for (let i = 0; i < 14 && status !== 422; i++) {
      const r = await admin.request('/api/upstreams', { body: { name: 'Meta', slug: `meta${i}`, type: 'rest', restTools: [{ name: 'm', urlTemplate: 'http://169.254.169.254/latest/meta-data' }] } })
      status = r.status
      if (status === 422) expect(r.json.data.code).toBe('ssrf_blocked')
      else await new Promise(res => setTimeout(res, 1000))
    }
    expect(status).toBe(422)
  })
})
