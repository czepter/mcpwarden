import { Agent, fetch as undiciFetch } from 'undici'
import { AllowList, assertUrlAllowed, createSafeLookup, SsrfBlockedError, systemResolver, type Resolver } from './ssrf'

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>

export class UpstreamRedirectError extends Error {
  readonly code = 'redirect'
  /** Redirect target without query and fragment (they may carry tokens), or undefined when unusable. */
  readonly target?: string
  constructor(target?: URL) {
    const shown = target && ['http:', 'https:'].includes(target.protocol) ? `${target.origin}${target.pathname}` : undefined
    super(shown ? `Upstream leitet um auf ${shown}, bitte diese URL eintragen` : 'Upstream leitet um, bitte Ziel-URL direkt eintragen')
    this.target = shown
  }
}

/**
 * A pure HTTPS upgrade: `http://host[:80]/path?q` -> `https://host[:443]/path?q`. Only this redirect is followed;
 * every other target could hand the upstream credentials to someone else.
 */
export function isHttpsUpgrade(from: URL, to: URL): boolean {
  return from.protocol === 'http:' && to.protocol === 'https:' && from.hostname === to.hostname
    && from.port === '' && to.port === '' && !to.username && !to.password
    && from.pathname === to.pathname && from.search === to.search
}

const toHttps = (u: URL) => { const x = new URL(u); x.protocol = 'https:'; return x }
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const MAX_UPGRADED_HOSTS = 1000

/** An upstream response exceeded the size the gateway is willing to buffer. */
export class UpstreamResponseTooLargeError extends Error {
  readonly code = 'too_large'
  constructor(max: number) { super(`Upstream-Antwort überschreitet ${max} Bytes`) }
}

/** Largest single (non-streaming) body and largest cumulative event stream accepted from an upstream. */
export const MAX_UPSTREAM_BODY_BYTES = 16 * 1024 * 1024
export const MAX_UPSTREAM_STREAM_BYTES = 64 * 1024 * 1024

/**
 * Counts decompressed bytes while the SDK reads the response and errors the stream once the bound is exceeded
 * (the SDK would otherwise buffer `response.json()` / a single SSE event without limit).
 */
export function capResponse(res: Response, bodyMax = MAX_UPSTREAM_BODY_BYTES, streamMax = MAX_UPSTREAM_STREAM_BYTES): Response {
  if (!res.body) return res
  const max = (res.headers.get('content-type') ?? '').toLowerCase().includes('text/event-stream') ? streamMax : bodyMax
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    void res.body.cancel().catch(() => {})
    throw new UpstreamResponseTooLargeError(max)
  }
  let n = 0
  const capped = res.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      n += chunk.byteLength
      if (n > max) ctl.error(new UpstreamResponseTooLargeError(max))
      else ctl.enqueue(chunk)
    },
  }))
  return new Response(capped, { status: res.status, statusText: res.statusText, headers: res.headers })
}

export type SafeFetchOptions = {
  /** Read fresh (the short cache lives with the caller, <= 10 s). */
  getAllow?: () => AllowList | Promise<AllowList>
  resolver?: Resolver
  connectTimeoutMs?: number
  /** Called on 429/503 with Retry-After (seconds). */
  onRetryAfter?: (host: string, seconds: number) => void
  /** Tests only: replaces the network call (the SSRF literal check and the redirect handling still run). */
  fetchImpl?: (url: URL, init: RequestInit & { redirect: 'manual' }) => Promise<Response>
}

function findCause<T extends Error>(e: unknown, pred: (x: unknown) => x is T): T | undefined {
  for (let c: unknown = e, i = 0; c && i < 6; i++, c = (c as { cause?: unknown }).cause) if (pred(c)) return c
}

/**
 * fetch for ALL SDK client transports: literal check before every request, DNS check at the
 * Connect-Lookup (undici-Dispatcher). Redirects are refused, except a pure HTTPS upgrade of the same host and path: that
 * one is followed and remembered for the host (like HSTS), so later requests go straight to https.
 */
export type SafeFetch = FetchLike & {
  close: () => Promise<void>
  /** The https URL this http URL was upgraded to (its host answered with a pure HTTPS upgrade), else null. */
  upgradedUrl: (url: string) => string | null
}

export function createSafeFetch(opts: SafeFetchOptions = {}): SafeFetch {
  const getAllow = opts.getAllow ?? (() => new AllowList())
  const dispatcher = new Agent({
    bodyTimeout: 0, // SSE-Streams
    headersTimeout: 60_000,
    connect: { timeout: opts.connectTimeoutMs ?? 10_000, lookup: createSafeLookup(getAllow, opts.resolver ?? systemResolver) as never },
  })
  // Hosts (host[:port] of the http URL) that answered with a pure HTTPS upgrade
  const upgraded = new Set<string>()
  const remember = (host: string) => {
    if (upgraded.size >= MAX_UPGRADED_HOSTS) upgraded.delete(upgraded.values().next().value!)
    upgraded.add(host)
  }
  const once = async (url: URL, init?: RequestInit) => {
    try {
      if (opts.fetchImpl) return await opts.fetchImpl(url, { ...init, redirect: 'manual' })
      return await undiciFetch(url, { ...(init as object), redirect: 'manual', dispatcher }) as unknown as Response
    } catch (e) {
      const ssrf = findCause(e, (x): x is SsrfBlockedError => x instanceof SsrfBlockedError)
      if (ssrf) throw ssrf
      throw e
    }
  }
  const f = (async (input: string | URL, init?: RequestInit) => {
    const allow = await getAllow()
    let url = assertUrlAllowed(input, allow)
    if (url.protocol === 'http:' && upgraded.has(url.host)) url = assertUrlAllowed(toHttps(url), allow)
    let res = await once(url, init)
    if (REDIRECT_STATUS.has(res.status)) {
      const loc = res.headers.get('location')
      void res.body?.cancel().catch(() => {})
      let target: URL | undefined
      try { target = loc ? new URL(loc, url) : undefined } catch { target = undefined }
      // The body must be sendable a second time (the SDK sends strings); a stream was already consumed
      const replayable = init?.body === undefined || init.body === null || typeof init.body === 'string'
      if (!target || !isHttpsUpgrade(url, target) || !replayable) throw new UpstreamRedirectError(target)
      remember(url.host)
      url = assertUrlAllowed(target, allow)
      res = await once(url, init)
      if (REDIRECT_STATUS.has(res.status)) {
        void res.body?.cancel().catch(() => {})
        let next: URL | undefined
        try { next = new URL(res.headers.get('location') ?? '', url) } catch { next = undefined }
        throw new UpstreamRedirectError(next)
      }
    }
    if ((res.status === 429 || res.status === 503) && opts.onRetryAfter) {
      const ra = Number(res.headers.get('retry-after'))
      if (Number.isFinite(ra) && ra > 0) opts.onRetryAfter(url.host, ra)
    }
    return capResponse(res)
  }) as SafeFetch
  f.upgradedUrl = (raw: string) => {
    try {
      const u = new URL(raw)
      return u.protocol === 'http:' && upgraded.has(u.host) ? toHttps(u).href : null
    } catch { return null }
  }
  let closing: Promise<void> | null = null
  f.close = () => (closing ??= dispatcher.close().catch(() => {}))
  return f
}
