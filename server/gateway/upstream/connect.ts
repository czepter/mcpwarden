import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Transport } from '@modelcontextprotocol/client'
import type { FetchLike } from '../net/safe-fetch'
import { mergeTimeouts } from '../config'
import { classifyError, CredentialsMissingError } from './errors'
import { withRetry } from './retry'
import type { UpstreamRow } from './types'

export type Credentials = { bearer?: string, headers?: Record<string, string>, env?: Record<string, string> }

export type ConnectDeps = {
  safeFetch: FetchLike
  /** Entschlüsselt frisch (nur hier, nie gecacht). */
  credentials: (up: UpstreamRow, owner: string) => Promise<Credentials>
  clientInfo?: { name: string, version: string }
  /** Für stdio: liefert den Transport über den Worker (Aufgabe 1.3). */
  stdioTransport?: (up: UpstreamRow, creds: Credentials) => Promise<Transport>
}

/** Standard ist `legacy`; nur `auto` spricht Revision 2026-07-28 (Abbruch = Stream schließen) und fällt sonst auf `initialize` zurück. */
export const clientOptions = (connectMs: number) => ({ versionNegotiation: { mode: 'auto' as const, probe: { timeoutMs: connectMs, maxRetries: 0 } } })

/** Bricht ab, sobald das Signal feuert (die SDK-Probe beachtet `signal` nicht überall). */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((res, rej) => {
    const onAbort = () => rej(signal.reason ?? new DOMException('aborted', 'AbortError'))
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(res, rej).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function authHeaders(up: UpstreamRow, c: Credentials): Record<string, string> {
  const h: Record<string, string> = {}
  if (up.authType === 'bearer' && c.bearer) h.Authorization = `Bearer ${c.bearer}`
  if (up.authType === 'header' && up.authHeaderName && c.headers?.[up.authHeaderName]) h[up.authHeaderName] = c.headers[up.authHeaderName]!
  return h
}

/**
 * Der EINZIGE Ort, an dem HTTP-Transporte gebaut werden (Lint-Regel/Test `no-direct-transport`);
 * alle mit `fetch: safeFetch`.
 */
function httpTransport(kind: 'streamable' | 'sse', url: URL, headers: Record<string, string>, safeFetch: FetchLike): Transport {
  const requestInit = { headers }
  return kind === 'streamable'
    ? new StreamableHTTPClientTransport(url, { fetch: safeFetch, requestInit })
    : new SSEClientTransport(url, { fetch: safeFetch, requestInit })
}

export type Connected = { client: Client, transport: 'streamable' | 'sse' | 'stdio' }

async function connectOnce(up: UpstreamRow, connectMs: number, kind: 'streamable' | 'sse', deps: ConnectDeps, headers: Record<string, string>, signal: AbortSignal): Promise<Client> {
  const client = new Client(deps.clientInfo ?? { name: 'mcpwarden', version: '0.1.0' }, clientOptions(connectMs))
  try {
    await raceAbort(client.connect(httpTransport(kind, new URL(up.url!), headers, deps.safeFetch), { signal }), signal)
    return client
  } catch (e) {
    await client.close().catch(() => {})
    throw e
  }
}

/** Verbindungsaufbau mit Timeout und (bei `auto`) SSE-Fallback mit frischem Client. Retry nur hier (Connect/Init). */
export async function connectUpstream(up: UpstreamRow, deps: ConnectDeps, signal?: AbortSignal, owner: string = up.userId): Promise<Connected & { retries: number }> {
  const t = mergeTimeouts(up.timeouts)
  if (up.type === 'stdio') {
    if (!deps.stdioTransport) throw new Error('stdio not available')
    const ms = Math.max(t.connectMs, 60_000)
    const client = new Client(deps.clientInfo ?? { name: 'mcpwarden', version: '0.1.0' }, clientOptions(ms))
    const sig = AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])])
    const transport = await deps.stdioTransport(up, await deps.credentials(up, owner))
    try {
      await raceAbort(client.connect(transport, { signal: sig }), sig)
    } catch (e) {
      // Timeout/Abbruch: sonst bleibt der Kindprozess im Worker übrig und erschöpft MAX_CHILDREN
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
      throw e
    }
    return { client, transport: 'stdio', retries: 0 }
  }
  const creds = await deps.credentials(up, owner)
  // Eine Auth-Art ohne passendes Secret nie still ohne Header verbinden
  if ((up.authType === 'bearer' && !creds.bearer) || (up.authType === 'header' && !(up.authHeaderName && creds.headers?.[up.authHeaderName]))) throw new CredentialsMissingError()
  const headers = authHeaders(up, creds)
  const attempt = async () => {
    const sig = AbortSignal.any([AbortSignal.timeout(t.connectMs), ...(signal ? [signal] : [])])
    const order: Array<'streamable' | 'sse'> = up.transport === 'auto' ? ['streamable', 'sse'] : [up.transport]
    let lastErr: unknown
    for (const kind of order) {
      try { return { client: await connectOnce(up, t.connectMs, kind, deps, headers, sig), transport: kind } } catch (e) {
        lastErr = e
        const c = classifyError(e, { hasAuth: up.authType !== 'none' })
        // Fallback nur wenn der Server Streamable nicht spricht; nie bei SSRF/Redirect/Auth/Timeout.
        if (kind === 'sse' || up.transport !== 'auto' || ['ssrf_blocked', 'redirect', 'unauthorized', 'timeout'].includes(c.code)) throw e
      }
    }
    throw lastErr
  }
  const { value, retries } = await withRetry(attempt, {
    signal,
    shouldRetry: e => classifyError(e, { hasAuth: up.authType !== 'none' }).counts,
  })
  return { ...value, retries }
}
