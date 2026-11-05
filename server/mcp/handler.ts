/**
 * /mcp-Handler (Plan 0b, Aufgaben 7 und 8): Gate-Reihenfolge Origin -> Methode -> Token ->
 * Zusatzpruefung (im Guard) -> MCP-Handler. Ein SDK-Handler je Nutzer, damit `list_changed` nur
 * die Streams dieses Nutzers erreicht. Zustandslos (`legacy: 'stateless'`), keine Session-ID.
 * Framework-frei: nimmt eine Web-`Request`, gibt eine Web-`Response` zurueck.
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
  /** Handler eines Nutzers ohne Aktivitaet so lange offen halten (Standard 10 min). */
  idleMs?: number
  /** Hoechstlaufzeit eines subscriptions/listen-Streams (Standard = Access-Token-TTL 300 s). */
  streamMaxMs?: number
  maxSubscriptions?: number
  /** Hoechstgroesse des Request-Bodys in Bytes (Standard 4 MiB); groessere Anfragen bekommen 413, ohne dass sie ganz gelesen werden. */
  maxBodyBytes?: number
}

export const MAX_BODY_BYTES = 4 * 1024 * 1024

/** Liest den Body hoechstens bis `max` Bytes (auch ohne Content-Length) und liefert einen neuen, lesbaren Request; sonst 413. */
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

/** Schliesst den Antwort-Stream nach `maxMs` (Client verbindet neu und durchlaeuft das Gate erneut). */
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
      if (request.method !== 'POST') return methodNotAllowed() // (b) Methode
      const auth = await deps.authenticate(request) // (c)+(d) Token und Zusatzpruefung
      if (auth instanceof Response) return auth
      const req = await boundedRequest(request, deps.maxBodyBytes ?? MAX_BODY_BYTES) // erst nach dem Token: Unbekannte lassen wir nichts hochladen
      if (req instanceof Response) return req
      const listen = await isListen(req) // vor fetch: danach ist der Body verbraucht
      const res = await handlerFor(auth.ctx.userId).fetch(req, { authInfo: toAuthInfo(auth.ctx, auth.token) }) // (e)
      return listen ? limitStream(res, deps.streamMaxMs ?? 300_000) : res
    },
    /** Meldet `tools/list_changed` an die offenen Listen-Streams genau dieses Nutzers. */
    notifyToolsChanged(userId: string): void {
      handlers.get(userId)?.handler.notify.toolsChanged()
    },
    /** Beendet alle offenen Streams/Anfragen eines Nutzers (Widerruf, Sperre). */
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
