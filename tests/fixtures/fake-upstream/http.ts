import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { buildFakeServer, newState, type FakeState } from './tools'

export type FakeHttp = {
  url: string
  port: number
  state: FakeState
  /** Offene Sockets (Leck-Nachweis). */
  openSockets: () => number
  /** Auth erzwingen: 401 ohne passenden Header. */
  requireHeader: (name: string, value: string) => void
  close: () => Promise<void>
}

/** Streamable HTTP, Revision 2026-07-28 (zustandslos, Legacy `stateless`). */
export async function startFakeHttp(opts: { toolNames?: string[], /** Listen-Adresse (Default Loopback; im Compose-Smoke 0.0.0.0). */ host?: string } = {}): Promise<FakeHttp> {
  const state = newState()
  const handler = createMcpHandler(() => buildFakeServer(state, opts), { legacy: 'stateless' })
  const node = toNodeHandler(handler)
  let required: [string, string] | null = null
  const sockets = new Set<import('node:net').Socket>()
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    state.requests.push({ method: req.method ?? '', headers: { ...req.headers } })
    res.on('close', () => { if (!res.writableFinished) state.aborted++ })
    if (required && req.headers[required[0].toLowerCase()] !== required[1]) { res.writeHead(401, { 'content-type': 'text/plain' }).end('unauthorized'); return }
    if (state.mode === 'hang-http') return // Antwort nie senden
    if (state.mode === 'status500' && req.method === 'POST') { res.writeHead(500).end('boom'); return }
    if (state.mode === 'retry429' && req.method === 'POST') { res.writeHead(429, { 'retry-after': '30' }).end('slow down'); return }
    void node(req, res)
  })
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  await new Promise<void>(r => server.listen(0, opts.host ?? '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/mcp`, port, state,
    openSockets: () => sockets.size,
    requireHeader: (n, v) => { required = [n, v] },
    close: async () => { await handler.close(); server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())) },
  }
}
