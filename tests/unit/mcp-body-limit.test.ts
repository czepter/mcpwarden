// Review L-d: /mcp liest nie mehr als das Body-Limit in den Speicher.
import { describe, expect, it } from 'vitest'
import type { AuthContext } from '../../server/auth/auth-context'
import { createGateway } from '../../server/mcp/handler'

const ctx: AuthContext = { userId: 'u', role: 'user', tokenType: 'pat', tokenId: 'p', clientId: null, clientName: null, scopes: ['mcp:tools'], expiresAt: null, resource: 'http://localhost/mcp' }
const MAX = 64 * 1024

function gw() {
  return createGateway({
    tools: { listTools: async () => [], callTool: async () => ({ content: [] }) } as never,
    cfg: { baseUrl: new URL('http://localhost'), allowedOrigins: ['http://localhost'] },
    maxBodyBytes: MAX,
    authenticate: async () => ({ ctx, token: 't' }),
  })
}

/** Strom, der mitzaehlt, wie viel gelesen wurde (Content-Length wird nicht gesetzt). */
function counting(total: number, chunk = 8 * 1024) {
  const state = { pulled: 0 }
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (state.pulled >= total) return c.close()
      state.pulled += chunk
      c.enqueue(new Uint8Array(chunk).fill(120))
    },
  })
  return { state, stream }
}
const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('http://localhost/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'host': 'localhost', ...headers }, body, duplex: 'half' } as RequestInit)

describe('/mcp body limit', () => {
  it('stops reading a chunked body at the limit and answers 413', async () => {
    const g = gw()
    const { state, stream } = counting(50 * 1024 * 1024)
    const res = await g.handle(post(stream))
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'payload_too_large' })
    expect(state.pulled).toBeLessThan(MAX + 256 * 1024) // nicht die 50 MiB
    await g.close()
  })
  it('refuses a declared oversized body without reading it', async () => {
    const g = gw()
    const { state, stream } = counting(10 * 1024 * 1024)
    const res = await g.handle(post(stream, { 'content-length': String(10 * 1024 * 1024) }))
    expect(res.status).toBe(413)
    expect(state.pulled).toBeLessThanOrEqual(16 * 1024) // höchstens der vorgeladene erste Chunk, nicht die 10 MiB
    await g.close()
  })
  it('a body within the limit is passed on intact', async () => {
    const g = gw()
    const res = await g.handle(post(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }), { accept: 'application/json, text/event-stream' }))
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"tools"')
    await g.close()
  })
})
