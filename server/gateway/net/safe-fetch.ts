import { Agent, fetch as undiciFetch } from 'undici'
import { AllowList, assertUrlAllowed, createSafeLookup, SsrfBlockedError, systemResolver, type Resolver } from './ssrf'

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>

export class UpstreamRedirectError extends Error {
  readonly code = 'redirect'
  constructor() { super('Upstream leitet um, bitte Ziel-URL direkt eintragen') }
}

export type SafeFetchOptions = {
  /** Read fresh (the short cache lives with the caller, <= 10 s). */
  getAllow?: () => AllowList | Promise<AllowList>
  resolver?: Resolver
  connectTimeoutMs?: number
  /** Called on 429/503 with Retry-After (seconds). */
  onRetryAfter?: (host: string, seconds: number) => void
}

function findCause<T extends Error>(e: unknown, pred: (x: unknown) => x is T): T | undefined {
  for (let c: unknown = e, i = 0; c && i < 6; i++, c = (c as { cause?: unknown }).cause) if (pred(c)) return c
}

/**
 * fetch for ALL SDK client transports: literal check before every request, DNS check at the
 * Connect-Lookup (undici-Dispatcher), `redirect: 'error'`.
 */
export function createSafeFetch(opts: SafeFetchOptions = {}): FetchLike & { close: () => Promise<void> } {
  const getAllow = opts.getAllow ?? (() => new AllowList())
  const dispatcher = new Agent({
    bodyTimeout: 0, // SSE-Streams
    headersTimeout: 60_000,
    connect: { timeout: opts.connectTimeoutMs ?? 10_000, lookup: createSafeLookup(getAllow, opts.resolver ?? systemResolver) as never },
  })
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = assertUrlAllowed(input, await getAllow())
    try {
      const res = await undiciFetch(url, { ...(init as object), redirect: 'error', dispatcher }) as unknown as Response
      if ((res.status === 429 || res.status === 503) && opts.onRetryAfter) {
        const ra = Number(res.headers.get('retry-after'))
        if (Number.isFinite(ra) && ra > 0) opts.onRetryAfter(url.host, ra)
      }
      return res
    } catch (e) {
      const ssrf = findCause(e, (x): x is SsrfBlockedError => x instanceof SsrfBlockedError)
      if (ssrf) throw ssrf
      if (/redirect/i.test(String((e as { cause?: Error }).cause?.message ?? ''))) throw new UpstreamRedirectError()
      throw e
    }
  }) as FetchLike & { close: () => Promise<void> }
  let closing: Promise<void> | null = null
  f.close = () => (closing ??= dispatcher.close().catch(() => {}))
  return f
}
