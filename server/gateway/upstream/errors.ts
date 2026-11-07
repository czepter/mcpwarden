import { SdkHttpError, ProtocolError, UnauthorizedError } from '@modelcontextprotocol/client'
import { SsrfBlockedError, SSRF_MESSAGE } from '../net/ssrf'
import { UpstreamRedirectError } from '../net/safe-fetch'
import { CatalogLimitError } from './catalog'

export type ErrorCode = 'ssrf_blocked' | 'redirect' | 'timeout' | 'connect_failed' | 'unauthorized' | 'upstream_error' | 'protocol' | 'awaiting_auth' | 'stdio_not_allowed' | 'cancelled'
/** No matching secret is stored for the auth kind (e.g. after renaming the header): do not connect without credentials. */
export class CredentialsMissingError extends Error {
  constructor() { super('credentials missing') }
}

/** The stored OAuth session is missing or no longer works (refresh failed): the user has to connect again. */
export class OAuthReauthError extends Error {
  constructor() { super('oauth reauthorization required') }
}

export type Classified = { code: ErrorCode, message: string, status?: number, /** counts for breaker/degraded */ counts: boolean, auth: boolean }

const chain = (e: unknown) => { const out: unknown[] = []; for (let c = e, i = 0; c && i < 6; i++, c = (c as { cause?: unknown }).cause) out.push(c); return out }

/** Sanitized messages: no internal IP, no secret. */
export function classifyError(e: unknown, opts: { hasAuth?: boolean, aborted?: boolean } = {}): Classified {
  const all = chain(e)
  if (all.some(x => x instanceof SsrfBlockedError || (x as Error)?.message?.includes(SSRF_MESSAGE))) return { code: 'ssrf_blocked', message: SSRF_MESSAGE, counts: false, auth: false }
  if (all.some(x => x instanceof CredentialsMissingError)) return { code: 'awaiting_auth', message: 'Zugangsdaten fehlen noch', counts: false, auth: false }
  if (all.some(x => x instanceof UpstreamRedirectError)) return { code: 'redirect', message: 'Upstream leitet um, bitte Ziel-URL direkt eintragen', counts: false, auth: false }
  if (all.some(x => x instanceof CatalogLimitError)) return { code: 'protocol', message: 'Upstream liefert eine zu grosse Tool-Liste', counts: true, auth: false }
  if (all.some(x => x instanceof OAuthReauthError || x instanceof UnauthorizedError)) {
    return { code: 'unauthorized', message: 'Anmeldung beim Upstream abgelaufen, bitte neu verbinden', counts: false, auth: true }
  }
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
