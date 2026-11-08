/**
 * REST upstream adapter: exposes the user's REST tool definitions through the same small client surface the pool, the catalog
 * and the proxy use for MCP upstreams (`listTools`, `callTool`, `close`, `onclose`). It is NOT an MCP connection; there is nothing
 * to connect, so "connecting" only snapshots the definitions and the credentials. All requests go through the injected safe fetch
 * (literal + DNS SSRF check, admin allow list, `redirect: 'error'`).
 */
import type { CallToolResult, Client, Tool } from '@modelcontextprotocol/client'
import type { FetchLike } from '../net/safe-fetch'
import { checkArguments, renderRequest, REST_LIMITS, RestToolError, type CheckedRestTool } from './template'

export type RestToolRow = CheckedRestTool & { id?: string }

export type RestClientOptions = {
  baseUrl: string | null
  tools: RestToolRow[]
  /** Headers of the upstream auth (bearer/header); applied last so a tool can never override them. */
  authHeaders: Record<string, string>
  safeFetch: FetchLike
  callMs: number
}

/** HTTP status the gateway should count against the breaker or treat as an auth failure (see `classifyError`). */
export class RestHttpError extends Error {
  constructor(readonly status: number) { super(`${status} vom Upstream`) }
}

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })

/** Reads at most `max` bytes; the rest of the stream is cancelled. */
async function readCapped(res: Response, max: number): Promise<{ bytes: Uint8Array, truncated: boolean }> {
  if (!res.body) return { bytes: new Uint8Array(), truncated: false }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      const keep = value.byteLength - (total - max)
      if (keep > 0) chunks.push(value.subarray(0, keep))
      truncated = true
      void reader.cancel().catch(() => {})
      break
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(Math.min(total, max))
  let at = 0
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength }
  return { bytes, truncated }
}

const TEXTUAL = /^(text\/|application\/(json|xml|x-www-form-urlencoded|[\w.+-]*\+(json|xml))|application\/(javascript|yaml|x-yaml))/i

/** Turns an HTTP response into tool content: JSON -> compact text, other text -> text, binary -> a one-line description. */
export async function responseToResult(res: Response): Promise<CallToolResult> {
  const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  const { bytes, truncated } = await readCapped(res, REST_LIMITS.responseBytes)
  const isErr = res.status >= 400
  if (type && !TEXTUAL.test(type) && bytes.byteLength > 0) return text(`HTTP ${res.status}: Antwort vom Typ ${type} (${bytes.byteLength}${truncated ? '+' : ''} Bytes) wird nicht übertragen.`, isErr)
  let body = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (/json/.test(type) && !truncated) { try { body = JSON.stringify(JSON.parse(body)) } catch { /* keep raw text */ } }
  let cut = truncated
  if (body.length > REST_LIMITS.responseChars) { body = body.slice(0, REST_LIMITS.responseChars); cut = true }
  const head = isErr ? `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}\n` : ''
  const out = text(`${head}${body}${cut ? '\n[Antwort gekürzt]' : ''}` || `HTTP ${res.status}`, isErr)
  return out
}

export class RestClient {
  onclose?: () => void
  /** The pool looks for `terminateSession` on the transport; there is none. */
  transport = undefined
  private closed = false
  private byName: Map<string, RestToolRow>
  constructor(private o: RestClientOptions) {
    this.byName = new Map(o.tools.filter(t => t.enabled).map(t => [t.name, t]))
  }

  async listTools(_params?: { cursor?: string }, _opts?: unknown): Promise<{ tools: Tool[], nextCursor?: string }> {
    const tools = [...this.byName.values()].map((t): Tool => ({
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      inputSchema: t.inputSchema as Tool['inputSchema'],
      annotations: { readOnlyHint: t.method === 'GET', destructiveHint: t.method === 'DELETE', idempotentHint: t.method !== 'POST' && t.method !== 'PATCH', openWorldHint: true },
    }))
    return { tools }
  }

  async callTool(p: { name: string, arguments?: Record<string, unknown> }, opts: { signal?: AbortSignal, timeout?: number } = {}): Promise<CallToolResult> {
    const tool = this.byName.get(p.name)
    if (!tool) return text(`Unbekanntes Tool ${p.name}`, true)
    let req
    try { req = renderRequest({ tool, baseUrl: this.o.baseUrl, args: p.arguments ?? {} }) } catch (e) {
      if (e instanceof RestToolError) return text(`Ungültiger Aufruf: ${e.message}`, true)
      throw e
    }
    const signal = AbortSignal.any([AbortSignal.timeout(opts.timeout ?? this.o.callMs), ...(opts.signal ? [opts.signal] : [])])
    // Upstream auth wins over anything a tool template sets
    const headers = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.1', ...req.headers, ...this.o.authHeaders }
    const res = await this.o.safeFetch(req.url, { method: req.method, headers, body: req.body ?? undefined, signal, redirect: 'error' })
    // 5xx and auth failures must reach the breaker/health logic as errors; other 4xx are a result the model can act on
    if (res.status >= 500 || res.status === 401 || res.status === 403) { void res.body?.cancel().catch(() => {}); throw new RestHttpError(res.status) }
    return await responseToResult(res)
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.onclose?.()
  }

  asClient(): Client { return this as unknown as Client }
}

/** Dry check of a call without sending it: the arguments against the schema. Used by tests and the editor's validation. */
export const validateCall = (t: RestToolRow, args: Record<string, unknown>) => checkArguments(t.inputSchema, args)
