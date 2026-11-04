import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Transport } from '@modelcontextprotocol/client'
import type { FetchLike } from '../net/safe-fetch'
import { mergeTimeouts } from '../config'
import { classifyError } from './errors'
import { withRetry } from './retry'
import type { UpstreamRow } from './types'

export type Credentials = { bearer?: string, headers?: Record<string, string> }

export type ConnectDeps = {
  safeFetch: FetchLike
  /** Entschlüsselt frisch (nur hier, nie gecacht). */
  credentials: (up: UpstreamRow) => Promise<Credentials>
  clientInfo?: { name: string, version: string }
  /** Für stdio: liefert den Transport über den Worker (Aufgabe 1.3). */
  stdioTransport?: (up: UpstreamRow) => Promise<Transport>
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

async function connectOnce(up: UpstreamRow, kind: 'streamable' | 'sse', deps: ConnectDeps, headers: Record<string, string>, signal: AbortSignal): Promise<Client> {
  const client = new Client(deps.clientInfo ?? { name: 'mcpwarden', version: '0.1.0' })
  try {
    await client.connect(httpTransport(kind, new URL(up.url!), headers, deps.safeFetch), { signal })
    return client
  } catch (e) {
    await client.close().catch(() => {})
    throw e
  }
}

/** Verbindungsaufbau mit Timeout und (bei `auto`) SSE-Fallback mit frischem Client. Retry nur hier (Connect/Init). */
export async function connectUpstream(up: UpstreamRow, deps: ConnectDeps, signal?: AbortSignal): Promise<Connected & { retries: number }> {
  const t = mergeTimeouts(up.timeouts)
  if (up.type === 'stdio') {
    if (!deps.stdioTransport) throw new Error('stdio not available')
    const client = new Client(deps.clientInfo ?? { name: 'mcpwarden', version: '0.1.0' })
    await client.connect(await deps.stdioTransport(up), { signal: AbortSignal.any([AbortSignal.timeout(Math.max(t.connectMs, 60_000)), ...(signal ? [signal] : [])]) })
    return { client, transport: 'stdio', retries: 0 }
  }
  const headers = authHeaders(up, await deps.credentials(up))
  const attempt = async () => {
    const sig = AbortSignal.any([AbortSignal.timeout(t.connectMs), ...(signal ? [signal] : [])])
    const order: Array<'streamable' | 'sse'> = up.transport === 'auto' ? ['streamable', 'sse'] : [up.transport]
    let lastErr: unknown
    for (const kind of order) {
      try { return { client: await connectOnce(up, kind, deps, headers, sig), transport: kind } } catch (e) {
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
    shouldRetry: (e) => { const c = classifyError(e, { hasAuth: up.authType !== 'none' }); return c.counts && c.code !== 'timeout' ? true : c.code === 'timeout' },
  })
  return { ...value, retries }
}
