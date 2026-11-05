/**
 * Protection against cross-site requests on cookie-authenticated, state-changing `/api/**` routes (review M-G).
 * Better Auth checks Origin only under `/api/auth/**`; our own routes (upstreams, secrets, admin, PATs, ...) read JSON, but also
 * accept `application/x-www-form-urlencoded` or no body at all, which a foreign form or `fetch(no-cors)` can send without a preflight.
 *  - Non-mutating methods (GET/HEAD/OPTIONS) and `/api/auth/**` (Better Auth) are exempt.
 *  - Requests with an `Authorization` header (PAT/Bearer) are exempt: a browser never attaches it on its own.
 *  - With `Origin`: it must be listed in BASE_URL/ALLOWED_ORIGINS. Without `Origin`: `Sec-Fetch-Site` may only be `same-origin`/`none`.
 *  - Neither Origin nor Sec-Fetch-Site (no browser, e.g. curl): let through; without a cookie, authentication fails anyway.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type CsrfInput = {
  method: string
  path: string
  origin?: string | null
  secFetchSite?: string | null
  hasAuthorization: boolean
  allowedOrigins: string[]
}

export function isCsrfViolation(i: CsrfInput): boolean {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return false
  if (!i.path.startsWith('/api/') || i.path.startsWith('/api/auth/')) return false
  if (i.hasAuthorization) return false
  if (i.origin) return !i.allowedOrigins.includes(i.origin)
  const site = i.secFetchSite?.toLowerCase()
  return !!site && site !== 'same-origin' && site !== 'none'
}
