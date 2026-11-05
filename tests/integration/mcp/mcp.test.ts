// Tasks 5, 6, 7, 8 against the built artifact: PAT routes, /mcp gate, SDK client, push and abort.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConnectionList, PatCreated, PatList } from '#shared/api-types'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from '../harness'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient
let userB: ApiClient
let mcpUrl: URL
let patA: PatCreated
let patB: PatCreated

const hdr = (token?: string, extra: Record<string, string> = {}) => ({ ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra })
const rpc = (body: unknown, headers: Record<string, string>) =>
  fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })
const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

async function connect(token: string, mode: 'legacy' | 'auto' = 'auto') {
  const client = new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode } })
  await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: hdr(token) } }))
  return client
}
const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  mcpUrl = new URL(`${srv.url}/mcp`)
  admin = await signUpFirstAdmin(srv)
  await createUser(admin, { name: 'B', email: 'b@example.com', password: 'password-b-12345' })
  userB = api(srv.url)
  await userB.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'password-b-12345' } })
  patA = (await admin.request('/api/me/pats', { body: { name: 'A-token' } })).json
  patB = (await userB.request('/api/me/pats', { body: { name: 'B-token' } })).json
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

describe('request body limit (review L-d)', () => {
  const big = (n: number) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'dummy__echo', arguments: { text: 'x'.repeat(n) } } })
  const post = (body: BodyInit, extra: Record<string, string> = {}, init: Record<string, unknown> = {}) =>
    fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', ...hdr(patA.token), ...extra }, body, ...init } as RequestInit)

  it('a declared body over the limit gets 413 without being processed', async () => {
    const r = await post(big(5 * 1024 * 1024))
    expect(r.status).toBe(413)
    expect(await r.json()).toEqual({ error: 'payload_too_large' })
  })
  it('a chunked body without Content-Length is cut off at the limit as well', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(256 * 1024))
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (sent >= 6 * 1024 * 1024) c.close(); else { sent += chunk.length; c.enqueue(chunk) } } })
    const r = await post(stream as never, {}, { duplex: 'half' })
    expect(r.status).toBe(413)
  })
  it('unauthenticated oversized requests are refused by the token check first (401)', async () => {
    const r = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: big(5 * 1024 * 1024) })
    expect(r.status).toBe(401)
  })
  it('a normal request below the limit still works', async () => {
    const r = await post(big(1000))
    expect(r.status).toBe(200)
  })
})

describe('PAT routes (task 5)', () => {
  it('creates with plaintext only in the POST response; list has prefix and limit', async () => {
    const r = await admin.request('/api/me/pats', { body: { name: '  second  ' } })
    expect(r.status).toBe(201)
    const created = r.json satisfies PatCreated
    expect(Object.keys(created).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt', 'token'])
    expect(created.token.startsWith('mcpw_pat_')).toBe(true)
    expect(created.prefix).toHaveLength(13)
    expect(created.token.startsWith(created.prefix)).toBe(true)
    expect(created.name).toBe('second')
    const list = await admin.request('/api/me/pats')
    const body = list.json satisfies PatList
    expect(body.limit).toEqual({ max: 20, active: 2 })
    expect(list.text).not.toContain(created.token)
    expect(list.text).not.toContain('tokenHash')
    expect(srv.logs()).not.toContain(created.token)
    await admin.request(`/api/me/pats/${created.id}`, { method: 'DELETE' })
  })
  it('lists are never cached', async () => {
    const jar = [...admin.jar].map(([k, v]) => `${k}=${v}`).join('; ')
    for (const path of ['/api/me/pats', '/api/me/connections', '/api/admin/oauth/clients']) {
      const res = await fetch(srv.url + path, { headers: { cookie: jar } })
      expect(res.headers.get('cache-control'), path).toBe('no-store')
    }
  })
  it('validates names and enforces the limit of 20 active tokens', async () => {
    for (const name of ['', '   ', 'x'.repeat(65), 5, undefined]) {
      const r = await admin.request('/api/me/pats', { body: { name } })
      expect(r.status).toBe(400)
      expect(r.json.data).toMatchObject({ code: 'invalid_name', field: 'name' })
    }
    const c = api(srv.url)
    await c.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'password-b-12345' } })
    const made: PatCreated[] = []
    for (let n = 0; n < 19; n++) made.push((await c.request('/api/me/pats', { body: { name: `t${n}` } })).json) // 1 existing + 19 = 20
    const over = await c.request('/api/me/pats', { body: { name: 'one-too-many' } })
    expect(over.status).toBe(409)
    expect(over.json.data.code).toBe('pat_limit_reached')
    await c.request(`/api/me/pats/${made[0]!.id}`, { method: 'DELETE' })
    expect((await c.request('/api/me/pats', { body: { name: 'fits-again' } })).status).toBe(201)
  })
  it('isolates users: B can neither see nor revoke the PAT of A (404)', async () => {
    const listB = (await userB.request('/api/me/pats')).json as PatList
    expect(listB.items.some(p => p.id === patA.id)).toBe(false)
    expect((await userB.request(`/api/me/pats/${patA.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, hdr(patA.token))).status).toBe(200)
  })
  it('anonymous callers get 401', async () => {
    expect((await api(srv.url).request('/api/me/pats')).status).toBe(401)
    expect((await api(srv.url).request('/api/me/connections')).status).toBe(401)
  })
  it('revoke is idempotent and takes effect on the next /mcp request; last_used_at is set', async () => {
    const p = (await admin.request('/api/me/pats', { body: { name: 'to-revoke' } })).json as PatCreated
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, hdr(p.token))).status).toBe(200)
    await vi.waitFor(async () => {
      const item = ((await admin.request('/api/me/pats')).json as PatList).items.find(i => i.id === p.id)!
      expect(item.lastUsedAt).not.toBeNull()
    })
    expect((await admin.request(`/api/me/pats/${p.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await admin.request(`/api/me/pats/${p.id}`, { method: 'DELETE' })).status).toBe(204)
    const after = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, hdr(p.token))
    expect(after.status).toBe(401)
    const item = ((await admin.request('/api/me/pats')).json as PatList).items.find(i => i.id === p.id)!
    expect(item.revokedAt).not.toBeNull()
    expect((await admin.request('/api/me/connections')).json satisfies ConnectionList).toEqual({ items: [] })
  })
})

describe('/mcp gate (task 7)', () => {
  it('no token and wrong tokens: 401 with resource_metadata, never a tool name', async () => {
    for (const method of ['tools/list', 'initialize']) {
      for (const h of [hdr(), hdr('mcpw_pat_nonsense'), hdr('not.a.jwt'), hdr('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.')]) {
        const res = await rpc({ jsonrpc: '2.0', id: 1, method, params: {} }, h)
        expect(res.status).toBe(401)
        expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${srv.url}/.well-known/oauth-protected-resource/mcp"`)
        expect(await res.text()).not.toContain('dummy')
      }
    }
  })
  it('origin: foreign 403, missing passes, GET/DELETE 405', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
    expect((await rpc(body, hdr(patA.token, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await rpc(body, hdr(patA.token, { origin: srv.url }))).status).toBe(200)
    expect((await rpc(body, hdr(patA.token))).status).toBe(200)
    for (const method of ['GET', 'DELETE']) expect((await fetch(mcpUrl, { method, headers: hdr(patA.token) })).status).toBe(405)
  })
  it('forwarded headers do not influence URLs', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, hdr(undefined, { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))
    expect(res.headers.get('www-authenticate')).toContain(`${srv.url}/.well-known/oauth-protected-resource/mcp`)
    expect(res.headers.get('www-authenticate')).not.toContain('evil')
  })
  it('unknown JSON-RPC methods and tools give errors without stack traces', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'nope/nope', params: {} }, hdr(patA.token))
    const t = await res.text()
    expect(t).not.toMatch(/at .*\.mjs|node_modules/)
  })
})

describe.each(['legacy', 'auto'] as const)('SDK client with PAT (%s)', (mode) => {
  it('lists and calls dummy tools; whoami reports the PAT context', async () => {
    const c = await connect(patA.token, mode)
    console.log(`protocol mode=${mode} negotiated=${c.getNegotiatedProtocolVersion?.()}`)
    const names = (await c.listTools()).tools.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['dummy__echo', 'dummy__add', 'dummy__whoami', 'dummy__slow_echo', 'dummy__toggle_tool']))
    expect((await c.callTool({ name: 'dummy__echo', arguments: { text: 'hallo' } })).content).toEqual([{ type: 'text', text: 'hallo' }])
    expect(text(await c.callTool({ name: 'dummy__add', arguments: { a: 2, b: 3 } }))).toBe('5')
    expect((await c.callTool({ name: 'dummy__add', arguments: { a: 'x' } })).isError).toBe(true)
    const who = JSON.parse(text(await c.callTool({ name: 'dummy__whoami', arguments: {} })))
    expect(who).toMatchObject({ role: 'admin', tokenType: 'pat', scopes: ['mcp:tools'] })
    expect((await c.callTool({ name: 'dummy__nope', arguments: {} })).isError).toBe(true)
    await c.close()
  })
})

describe('push, tenancy and abort (task 8)', () => {
  it('toggle_tool pushes tools/list_changed only to the same user; 2025 client sees it on the next list', async () => {
    const a = await connect(patA.token)
    const b = await connect(patB.token)
    const legacy = await connect(patA.token, 'legacy')
    const gotA = vi.fn()
    const gotB = vi.fn()
    a.setNotificationHandler('notifications/tools/list_changed', gotA)
    b.setNotificationHandler('notifications/tools/list_changed', gotB)
    const subA = await a.listen({ toolsListChanged: true })
    const subB = await b.listen({ toolsListChanged: true })
    await a.callTool({ name: 'dummy__toggle_tool', arguments: {} })
    await vi.waitFor(() => expect(gotA).toHaveBeenCalledTimes(1))
    await tick(300)
    expect(gotB).not.toHaveBeenCalled()
    expect((await a.listTools()).tools.map(t => t.name)).not.toContain('dummy__echo')
    expect((await b.listTools()).tools.map(t => t.name)).toContain('dummy__echo')
    expect((await legacy.listTools()).tools.map(t => t.name)).not.toContain('dummy__echo')
    await a.callTool({ name: 'dummy__toggle_tool', arguments: {} })
    await subA.close(); await subB.close()
    await Promise.all([a.close(), b.close(), legacy.close()])
  })
  it('revoking a PAT closes the open listen stream of that user only', async () => {
    const extra = (await admin.request('/api/me/pats', { body: { name: 'stream' } })).json as PatCreated
    const a = await connect(extra.token)
    const b = await connect(patB.token)
    const subA = await a.listen({ toolsListChanged: true })
    const subB = await b.listen({ toolsListChanged: true })
    await admin.request(`/api/me/pats/${extra.id}`, { method: 'DELETE' })
    expect(await Promise.race([subA.closed, tick(3000).then(() => 'timeout')])).not.toBe('timeout')
    expect(await Promise.race([subB.closed, tick(300).then(() => 'open')])).toBe('open')
    await subB.close()
    await Promise.all([a.close().catch(() => {}), b.close()])
  })
  it('aborting a running slow_echo makes the ToolSource see the signal (HTTP abort = stream close)', async () => {
    const c = await connect(patA.token)
    const before = Number(text(await c.callTool({ name: 'dummy__abort_count', arguments: {} })))
    const ac = new AbortController()
    const call = c.callTool({ name: 'dummy__slow_echo', arguments: { text: 'x', ms: 20_000 } }, { signal: ac.signal })
    await tick(400)
    ac.abort()
    await call.catch(() => {})
    await vi.waitFor(async () => {
      const c2 = await connect(patA.token)
      try {
        expect(Number(text(await c2.callTool({ name: 'dummy__abort_count', arguments: {} })))).toBe(before + 1)
      } finally { await c2.close() }
    }, { timeout: 5000, interval: 300 })
    await c.close()
  })
})
