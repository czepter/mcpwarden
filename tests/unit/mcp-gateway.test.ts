import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthContext } from '../../server/auth/auth-context'
import { createGateway } from '../../server/mcp/handler'
import { createDummyUpstream } from '../../server/mcp/dummy-upstream'
import { unauthorized } from '../../server/mcp/errors'

const PRM = 'http://localhost/.well-known/oauth-protected-resource/mcp'
const ctxFor = (userId: string): AuthContext => ({
  userId, role: 'user', tokenType: 'pat', tokenId: `p-${userId}`, clientId: null, clientName: null, scopes: ['mcp:tools'], expiresAt: null, resource: 'http://localhost/mcp',
})

let http: Server
let url: URL
let gateway: ReturnType<typeof createGateway>
const aborted = vi.fn()

beforeAll(async () => {
  const tools = createDummyUpstream({ notify: id => gateway.notifyToolsChanged(id), onAbort: aborted })
  gateway = createGateway({
    tools,
    cfg: { baseUrl: new URL('http://127.0.0.1'), allowedOrigins: ['http://127.0.0.1'] },
    streamMaxMs: 3000,
    authenticate: async (req) => {
      const m = /^Bearer (tok[AB])$/.exec(req.headers.get('authorization') ?? '')
      return m ? { ctx: ctxFor(m[1]!.slice(3)), token: m[1]! } : unauthorized(PRM)
    },
  })
  http = createServer(async (req, res) => {
    const ac = new AbortController()
    res.on('close', () => ac.abort())
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
    const body = chunks.length && req.method === 'POST' ? Buffer.concat(chunks) : undefined
    const out = await gateway.handle(new Request(`http://localhost${req.url}`, { method: req.method, headers, body, signal: ac.signal }))
    res.writeHead(out.status, Object.fromEntries(out.headers))
    if (!out.body) return res.end()
    const reader = out.body.getReader()
    res.on('close', () => void reader.cancel().catch(() => {}))
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (done) break
      res.write(value)
    }
    res.end()
  })
  await new Promise<void>(r => http.listen(0, '127.0.0.1', r))
  url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`)
})
afterAll(async () => {
  await gateway.close()
  http.closeAllConnections()
  http.close()
})

const hdr = (token?: string, extra: Record<string, string> = {}) => ({
  ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra,
})

async function connect(token: string, mode: 'legacy' | 'auto') {
  const client = new Client({ name: 'test', version: '1' }, { versionNegotiation: { mode } })
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: hdr(token) } }))
  return client
}

const rpc = (body: unknown, headers: Record<string, string>) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) })

describe('gate', () => {
  it('no token -> 401 with resource_metadata and no tool leak; initialize also 401', async () => {
    for (const method of ['tools/list', 'initialize']) {
      const res = await rpc({ jsonrpc: '2.0', id: 1, method, params: {} }, hdr())
      expect(res.status).toBe(401)
      expect(res.headers.get('www-authenticate')).toContain(`resource_metadata="${PRM}"`)
      expect(await res.text()).not.toContain('dummy')
    }
  })
  it('bad origin -> 403, no origin passes, GET/DELETE -> 405', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
    expect((await rpc(body, hdr('tokA', { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await rpc(body, hdr('tokA'))).status).not.toBe(403)
    for (const method of ['GET', 'DELETE']) expect((await fetch(url, { method, headers: hdr('tokA') })).status).toBe(405)
  })
})

describe.each(['legacy', 'auto'] as const)('sdk client (%s)', (mode) => {
  it('lists and calls dummy tools', async () => {
    const c = await connect('tokA', mode)
    console.log(`negotiated mode=${mode} protocol=${c.getNegotiatedProtocolVersion?.()}`)
    const names = (await c.listTools()).tools.map(t => t.name)
    expect(names).toEqual(expect.arrayContaining(['dummy__echo', 'dummy__add', 'dummy__whoami']))
    const echo = await c.callTool({ name: 'dummy__echo', arguments: { text: 'hallo' } })
    expect(echo.content).toEqual([{ type: 'text', text: 'hallo' }])
    expect((await c.callTool({ name: 'dummy__add', arguments: { a: 2, b: 3 } })).content).toEqual([{ type: 'text', text: '5' }])
    const bad = await c.callTool({ name: 'dummy__add', arguments: { a: 'x' } })
    expect(bad.isError).toBe(true)
    const who = JSON.parse(((await c.callTool({ name: 'dummy__whoami', arguments: {} })).content[0] as { text: string }).text)
    expect(who).toEqual({ userId: 'A', role: 'user', tokenType: 'pat', scopes: ['mcp:tools'] })
    expect((await c.callTool({ name: 'dummy__nope', arguments: {} })).isError).toBe(true)
    await c.close()
  })
})

const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('push, tenancy, abort (modern clients)', () => {
  it('toggle_tool pushes tools/list_changed only to the same user; legacy client gets no push', async () => {
    const a = await connect('tokA', 'auto')
    const b = await connect('tokB', 'auto')
    const legacy = await connect('tokA', 'legacy')
    const gotA = vi.fn()
    const gotB = vi.fn()
    a.setNotificationHandler('notifications/tools/list_changed', gotA)
    b.setNotificationHandler('notifications/tools/list_changed', gotB)
    const subA = await a.listen({ toolsListChanged: true })
    const subB = await b.listen({ toolsListChanged: true })

    await a.callTool({ name: 'dummy__toggle_tool', arguments: {} })
    await vi.waitFor(() => expect(gotA).toHaveBeenCalledTimes(1))
    await tick(200)
    expect(gotB).not.toHaveBeenCalled()
    expect((await a.listTools()).tools.map(t => t.name)).not.toContain('dummy__echo')
    expect((await b.listTools()).tools.map(t => t.name)).toContain('dummy__echo')
    // 2025er-Client: kein Push, sieht die Aenderung beim naechsten tools/list
    expect((await legacy.listTools()).tools.map(t => t.name)).not.toContain('dummy__echo')

    await a.callTool({ name: 'dummy__toggle_tool', arguments: {} }) // zuruecksetzen
    await subA.close(); await subB.close()
    await Promise.all([a.close(), b.close(), legacy.close()])
  })

  it('closeUserStreams ends only that user\'s open listen stream', async () => {
    const a = await connect('tokA', 'auto')
    const b = await connect('tokB', 'auto')
    const subA = await a.listen({ toolsListChanged: true })
    const subB = await b.listen({ toolsListChanged: true })
    await gateway.closeUserStreams('A')
    expect(await Promise.race([subA.closed, tick(2000).then(() => 'timeout')])).not.toBe('timeout')
    expect(await Promise.race([subB.closed, tick(300).then(() => 'open')])).toBe('open')
    await subB.close()
    await Promise.all([a.close(), b.close()])
  })

  it('closing the response stream aborts a running slow_echo (ToolSource sees the signal)', async () => {
    aborted.mockClear()
    const c = await connect('tokA', 'auto')
    const ac = new AbortController()
    const call = c.callTool({ name: 'dummy__slow_echo', arguments: { text: 'x', ms: 20_000 } }, { signal: ac.signal })
    await tick(300)
    ac.abort()
    await call.catch(() => {})
    await vi.waitFor(() => expect(aborted).toHaveBeenCalledWith('dummy__slow_echo'), { timeout: 3000 })
    await c.close()
  })

  it('listen stream is closed after the maximum lifetime', async () => {
    const a = await connect('tokA', 'auto')
    const sub = await a.listen({ toolsListChanged: true })
    expect(await Promise.race([sub.closed, tick(6000).then(() => 'still open')])).not.toBe('still open')
    await a.close()
  }, 10_000)
})
