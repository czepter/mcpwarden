/**
 * /mcp handler (plan 0b, tasks 7 and 8): gate order Origin -> method -> token ->
 * additional check (in the guard) -> MCP handler. One SDK handler per user so that `list_changed` reaches
 * only this user's streams. Stateless (`legacy: 'stateless'`), no session ID.
 * Framework-free: takes a web `Request`, returns a web `Response`.
 */
import { createMcpHandler, Server, type McpHttpHandler } from '@modelcontextprotocol/server'
import { getAuthContext, toAuthInfo, type AuthContext } from '../auth/auth-context'
import { checkOrigin } from './discovery'
import { methodNotAllowed, payloadTooLarge } from './errors'
import type { ToolSource } from './upstream-port'

export type GatewayDeps = {
  authenticate(request: Request): Promise<{ ctx: AuthContext, token: string } | Response>
  tools: ToolSource
  cfg: { baseUrl: URL, allowedOrigins: string[] }
  /** Keep a user's handler open this long without activity (default 10 min). */
  idleMs?: number
  /** Maximum run time of a subscriptions/listen stream (default = access token TTL 300 s). */
  streamMaxMs?: number
  maxSubscriptions?: number
  /** Maximum size of the request body in bytes (default 4 MiB); larger requests get 413 without being read in full. */
  maxBodyBytes?: number
}

export const MAX_BODY_BYTES = 4 * 1024 * 1024

/** Reads the body up to at most `max` bytes (even without Content-Length) and returns a new, readable request; otherwise 413. */
async function boundedRequest(request: Request, max: number): Promise<Request | Response> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return payloadTooLarge()
  if (!request.body) return request
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { void reader.cancel().catch(() => {}); return payloadTooLarge() }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { body.set(c, at); at += c.byteLength }
  return new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal })
}

type Entry = { handler: McpHttpHandler, lastUsed: number }

function buildServer(deps: GatewayDeps, authInfo: Parameters<typeof getAuthContext>[0]): Server {
  const ctx = getAuthContext(authInfo)
  const server = new Server({ name: 'mcpwarden', version: '0.0.0' }, { capabilities: { tools: { listChanged: true } } })
  server.setRequestHandler('tools/list', async () => ({ tools: await deps.tools.listTools(ctx) }))
  server.setRequestHandler('tools/call', async (req, c) =>
    deps.tools.callTool(ctx, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>, { signal: c.mcpReq.signal }))
  return server
}

async function isListen(request: Request): Promise<boolean> {
  try {
    return (await request.clone().json())?.method === 'subscriptions/listen'
  } catch {
    return false
  }
}

/** Closes the response stream after `maxMs` (the client reconnects and passes the gate again). */
function limitStream(res: Response, maxMs: number): Response {
  if (!res.body) return res
  const reader = res.body.getReader()
  let timer: ReturnType<typeof setTimeout>
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => { controller.close(); void reader.cancel().catch(() => {}) }, maxMs)
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { clearTimeout(timer); controller.close() } else controller.enqueue(value)
      } catch { clearTimeout(timer) }
    },
    cancel(reason) { clearTimeout(timer); return reader.cancel(reason) },
  })
  return new Response(body, { status: res.status, headers: res.headers })
}

export function createGateway(deps: GatewayDeps) {
  const handlers = new Map<string, Entry>()
  const idleMs = deps.idleMs ?? 600_000
  const sweep = setInterval(() => {
    const t = Date.now()
    for (const [id, e] of handlers) if (t - e.lastUsed > idleMs) { handlers.delete(id); void e.handler.close() }
  }, Math.min(idleMs, 60_000))
  sweep.unref()

  function handlerFor(userId: string): McpHttpHandler {
    let e = handlers.get(userId)
    if (!e) {
      e = { lastUsed: 0, handler: createMcpHandler(mctx => buildServer(deps, mctx.authInfo), { legacy: 'stateless', maxSubscriptions: deps.maxSubscriptions ?? 16 }) }
      handlers.set(userId, e)
    }
    e.lastUsed = Date.now()
    return e.handler
  }

  return {
    async handle(request: Request): Promise<Response> {
      const rejected = checkOrigin(request, deps.cfg) // (a) Origin
      if (rejected) return rejected
      if (request.method !== 'POST') return methodNotAllowed() // (b) method
      const auth = await deps.authenticate(request) // (c)+(d) token and additional check
      if (auth instanceof Response) return auth
      const req = await boundedRequest(request, deps.maxBodyBytes ?? MAX_BODY_BYTES) // only after the token: we let unknown callers upload nothing
      if (req instanceof Response) return req
      const listen = await isListen(req) // before fetch: afterwards the body is consumed
      const res = await handlerFor(auth.ctx.userId).fetch(req, { authInfo: toAuthInfo(auth.ctx, auth.token) }) // (e)
      return listen ? limitStream(res, deps.streamMaxMs ?? 300_000) : res
    },
    /** Reports `tools/list_changed` to exactly this user's open list streams. */
    notifyToolsChanged(userId: string): void {
      handlers.get(userId)?.handler.notify.toolsChanged()
    },
    /** Closes all open streams/requests of a user (revocation, ban). */
    async closeUserStreams(userId: string): Promise<void> {
      const e = handlers.get(userId)
      handlers.delete(userId)
      await e?.handler.close()
    },
    async close(): Promise<void> {
      clearInterval(sweep)
      const all = [...handlers.values()]
      handlers.clear()
      await Promise.all(all.map(e => e.handler.close()))
    },
  }
}
