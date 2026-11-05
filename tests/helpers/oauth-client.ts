// Minimal OAuth test client (fetch-based): simulates browser and MCP client so that every HTTP stage
// stays checkable. Uses the harness cookie jar (`ApiClient`) as the "browser".
import { createHash, randomBytes } from 'node:crypto'
import type { ApiClient } from '../integration/harness'

export function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export const REDIRECT = 'http://127.0.0.1:53124/callback'

export interface RegisterMeta {
  client_name?: string
  redirect_uris?: string[]
  scope?: string
  token_endpoint_auth_method?: string
  grant_types?: string[]
  response_types?: string[]
  [k: string]: unknown
}

async function json(res: Response) {
  const text = await res.text()
  try { return { status: res.status, json: JSON.parse(text) as any, text, headers: res.headers } } catch { return { status: res.status, json: undefined as any, text, headers: res.headers } } // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Anonymous DCR (RFC 7591), as an MCP client performs it. */
export async function registerClient(baseUrl: string, meta: RegisterMeta = {}, ip = '198.51.100.9') {
  const res = await fetch(`${baseUrl}/api/auth/oauth2/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({
      client_name: 'Claude Code (test)',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...meta,
    }),
  })
  return json(res)
}

export function cookieHeader(c: ApiClient): string {
  return [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

/** GET without following redirects, with the "browser's" cookies. */
export async function getRaw(c: ApiClient, url: string) {
  const res = await fetch(url, { redirect: 'manual', headers: { cookie: cookieHeader(c), accept: 'text/html' } })
  const text = await res.text()
  // Browsers (Accept: text/html) get 302; without this header the plugin returns 200 `{ redirect, url }`.
  let location = res.headers.get('location')
  if (!location && res.status === 200) { try { location = JSON.parse(text).url ?? null } catch { /* no JSON */ } }
  return { status: res.status, location, text }
}

export interface AuthorizeParams {
  clientId: string
  redirectUri?: string
  scope?: string | null
  resource?: string | null
  state?: string
  challenge?: string | null
  challengeMethod?: string
}

export function authorizeUrl(baseUrl: string, p: AuthorizeParams): string {
  const q = new URLSearchParams({ response_type: 'code', client_id: p.clientId, redirect_uri: p.redirectUri ?? REDIRECT, state: p.state ?? 'st-1' })
  if (p.scope !== null) q.set('scope', p.scope ?? 'openid offline_access mcp:tools')
  if (p.resource !== null && p.resource !== undefined) q.set('resource', p.resource)
  if (p.challenge !== null) {
    q.set('code_challenge', p.challenge ?? 'x'.repeat(43))
    q.set('code_challenge_method', p.challengeMethod ?? 'S256')
  }
  return `${baseUrl}/api/auth/oauth2/authorize?${q}`
}

/**
 * Authorize + consent, the way the frontend does it: `authorize` redirects (with a session) to the
 * consent page with a signed query; the frontend calls `consent-info`, then `oauth2/consent`
 * with `oauth_query` (= unchanged query of the consent page) and follows the `url` of the response.
 */
export async function authorizeAndConsent(user: ApiClient, baseUrl: string, p: AuthorizeParams & { consentScope?: string, accept?: boolean }) {
  const a = await getRaw(user, authorizeUrl(baseUrl, p))
  if (!a.location) return { step: 'authorize' as const, authorize: a }
  const loc = new URL(a.location, baseUrl)
  if (!loc.pathname.startsWith('/consent')) return { step: 'authorize' as const, authorize: a }
  const oauthQuery = loc.search.slice(1)
  const info = await user.request(`/api/oauth/consent-info?${oauthQuery}`)
  const c = await user.request('/api/auth/oauth2/consent', {
    body: { accept: p.accept ?? true, oauth_query: oauthQuery, ...(p.consentScope !== undefined ? { scope: p.consentScope } : {}) },
  })
  if (c.status !== 200 || !c.json?.url) return { step: 'consent' as const, authorize: a, oauthQuery, info, consent: c }
  const redirect = new URL(c.json.url, baseUrl)
  return { step: 'done' as const, authorize: a, oauthQuery, info, consent: c, redirect, code: redirect.searchParams.get('code'), state: redirect.searchParams.get('state'), iss: redirect.searchParams.get('iss'), error: redirect.searchParams.get('error') }
}

export async function tokenRequest(baseUrl: string, form: Record<string, string | undefined>, ip = '198.51.100.9') {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(form)) if (v !== undefined) body.set(k, v)
  const res = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body,
  })
  return json(res)
}

export function exchangeCode(baseUrl: string, o: { clientId: string, code: string, verifier: string, redirectUri?: string, resource?: string }) {
  return tokenRequest(baseUrl, { grant_type: 'authorization_code', client_id: o.clientId, code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri ?? REDIRECT, resource: o.resource })
}

export function refresh(baseUrl: string, o: { clientId: string, refreshToken: string, resource?: string }) {
  return tokenRequest(baseUrl, { grant_type: 'refresh_token', client_id: o.clientId, refresh_token: o.refreshToken, resource: o.resource })
}

export async function revokeToken(baseUrl: string, o: { clientId: string, token: string, hint?: 'refresh_token' | 'access_token' }) {
  const body = new URLSearchParams({ client_id: o.clientId, token: o.token, ...(o.hint ? { token_type_hint: o.hint } : {}) })
  const res = await fetch(`${baseUrl}/api/auth/oauth2/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  return json(res)
}

export function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString())
}

/** Complete run through to the token pair. */
export async function fullFlow(user: ApiClient, baseUrl: string, o: { resource?: string | null, scope?: string, meta?: RegisterMeta } = {}) {
  const reg = await registerClient(baseUrl, o.meta)
  const clientId = reg.json.client_id as string
  const { verifier, challenge } = pkce()
  const resource = o.resource === null ? null : (o.resource ?? `${baseUrl}/mcp`)
  const r = await authorizeAndConsent(user, baseUrl, { clientId, challenge, resource, scope: o.scope })
  if (r.step !== 'done' || !r.code) throw new Error(`Authorize failed: ${JSON.stringify(r)}`)
  const tok = await exchangeCode(baseUrl, { clientId, code: r.code, verifier, resource: resource ?? undefined })
  return { clientId, reg, tok, flow: r }
}
