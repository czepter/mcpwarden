/** Upper bound for JSON bodies on `/api/**` (the largest legitimate one is the 256 KB import). */
export const MAX_API_BODY_BYTES = 1024 * 1024

/**
 * Decides without reading the body: 413 if the declared size is too large, 411 for a body without a declared length
 * (chunked), `null` if fine. `/api/auth/` is bounded while it is read (see `dispatchAuth`), `/mcp` has its own bound.
 */
export function bodyLimitViolation(o: { method: string, path: string, contentLength?: string, transferEncoding?: string }): 413 | 411 | null {
  if (!o.path.startsWith('/api/') || o.path.startsWith('/api/auth/')) return null
  if (o.method === 'GET' || o.method === 'HEAD' || o.method === 'OPTIONS') return null
  const len = o.contentLength === undefined || o.contentLength === '' ? NaN : Number(o.contentLength)
  if (Number.isFinite(len)) return len > MAX_API_BODY_BYTES ? 413 : null
  return o.transferEncoding ? 411 : null
}
