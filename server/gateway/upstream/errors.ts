import { SdkHttpError, ProtocolError } from '@modelcontextprotocol/client'
import { SsrfBlockedError, SSRF_MESSAGE } from '../net/ssrf'
import { UpstreamRedirectError } from '../net/safe-fetch'

export type ErrorCode = 'ssrf_blocked' | 'redirect' | 'timeout' | 'connect_failed' | 'unauthorized' | 'upstream_error' | 'protocol' | 'awaiting_auth' | 'stdio_not_allowed' | 'cancelled'
export type Classified = { code: ErrorCode, message: string, status?: number, /** zählt für Breaker/Degraded */ counts: boolean, auth: boolean }

const chain = (e: unknown) => { const out: unknown[] = []; for (let c = e, i = 0; c && i < 6; i++, c = (c as { cause?: unknown }).cause) out.push(c); return out }

/** Bereinigte Meldungen: keine interne IP, kein Secret. */
export function classifyError(e: unknown, opts: { hasAuth?: boolean, aborted?: boolean } = {}): Classified {
  const all = chain(e)
  if (all.some(x => x instanceof SsrfBlockedError)) return { code: 'ssrf_blocked', message: SSRF_MESSAGE, counts: false, auth: false }
  if (all.some(x => x instanceof UpstreamRedirectError)) return { code: 'redirect', message: 'Upstream leitet um, bitte Ziel-URL direkt eintragen', counts: false, auth: false }
  const http = all.find((x): x is SdkHttpError => x instanceof SdkHttpError)
  const status = http?.status ?? (all.map(x => (x as { status?: number, code?: number }).status).find(s => typeof s === 'number'))
  if (status === 401 || status === 403) {
    return { code: 'unauthorized', message: `${status} vom Upstream`, status, counts: false, auth: !!opts.hasAuth }
  }
  if (typeof status === 'number' && status >= 500) return { code: 'upstream_error', message: `${status} vom Upstream`, status, counts: true, auth: false }
  if (typeof status === 'number' && status >= 400) return { code: 'upstream_error', message: `${status} vom Upstream`, status, counts: false, auth: false }
  if (all.some(x => (x as Error)?.name === 'TimeoutError' || (x as { code?: string })?.code === 'REQUEST_TIMEOUT')) {
    return { code: 'timeout', message: 'Zeitüberschreitung beim Upstream', counts: true, auth: false }
  }
  if (opts.aborted || all.some(x => (x as Error)?.name === 'AbortError')) return { code: 'cancelled', message: 'Aufruf abgebrochen', counts: false, auth: false }
  const proto = all.find((x): x is ProtocolError => x instanceof ProtocolError)
  if (proto) return { code: 'protocol', message: 'Protokollfehler vom Upstream', counts: false, auth: false }
  return { code: 'connect_failed', message: 'Verbindung zum Upstream fehlgeschlagen', counts: true, auth: false }
}
