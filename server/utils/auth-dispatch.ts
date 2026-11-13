import { withMutex } from './mutex'

/** Upper bound for bodies reaching Better Auth (sign-in, sign-up, DCR, token exchange are all tiny). */
export const MAX_AUTH_BODY_BYTES = 256 * 1024

const tooLarge = () => new Response(JSON.stringify({ error: 'payload_too_large' }), { status: 413, headers: { 'content-type': 'application/json' } })

/**
 * Reads the body up to `max` bytes (also without Content-Length) and returns a new, fully buffered request,
 * or `null` if the body is larger. Reading happens BEFORE any lock is taken, so a slow sender cannot hold it.
 */
export async function bufferRequest(req: Request, max: number): Promise<Request | null> {
  if (!req.body || req.method === 'GET' || req.method === 'HEAD') return req
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) { void req.body.cancel().catch(() => {}); return null }
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) { void reader.cancel().catch(() => {}); return null }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { body.set(c, at); at += c.byteLength }
  const headers = new Headers(req.headers)
  headers.delete('content-length')
  headers.delete('transfer-encoding')
  return new Request(req.url, { method: req.method, headers, body, signal: req.signal })
}

/** True for the sign-up endpoint, decided on the URL the auth handler will actually dispatch (after URL normalisation). */
export const isSignUp = (req: Request): boolean => req.method === 'POST' && new URL(req.url).pathname.endsWith('/sign-up/email')

/**
 * The ONE entry into Better Auth for every route that forwards to it (`/api/auth/**` and `/.well-known/**`).
 * - The body is bounded and buffered first (413 if too large), so no unauthenticated request can stream unbounded data
 *   and a trickled body never holds the sign-up lock.
 * - Sign-up runs in the mutex ("count, check, create" is atomic: two first registrations never yield two admins). The
 *   decision is made on the normalised request URL, so a path such as `/.well-known/%2e%2e/api/auth/sign-up/email`
 *   cannot skip the lock by being routed through a different Nitro route.
 */
export async function dispatchAuth(auth: { handler: (req: Request) => Promise<Response> }, req: Request): Promise<Response> {
  const bounded = await bufferRequest(req, MAX_AUTH_BODY_BYTES)
  if (!bounded) return tooLarge()
  return isSignUp(bounded) ? withMutex(() => auth.handler(bounded)) : auth.handler(bounded)
}
