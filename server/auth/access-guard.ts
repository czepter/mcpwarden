/**
 * Token verification and access check per /mcp request (plan 0b, task 6).
 * All dependencies are injected: the token verifier (Better Auth, 0a) and the DB access
 * (`AccessStore`). No caching: revocation takes effect on the next request.
 */
import { timingSafeEqual } from 'node:crypto'
import { forbidden, unauthorized } from '../mcp/errors'
import type { AuthContext } from './auth-context'
import { createUseThrottle } from './client-meta'
import { hashPat, isPatToken } from './pat'
import { SCOPE_MCP_TOOLS } from './scopes'
import { sanitizeClientName } from './dcr-policy'

/** Verified JWT (signature, issuer, expiry already checked by the verifier). `null` = invalid. */
export type VerifiedAccessToken = {
  userId: string
  clientId: string
  scopes: string[]
  audience: string[]
  expiresAt: number // Unix seconds
  jti?: string
}

export type UserRow = { id: string, role: 'admin' | 'user', banned: boolean, banExpires: Date | null }

/** Result of the (combined) indexed query for OAuth tokens. */
export type OAuthAccessRow = {
  user: UserRow | null
  client: { id: string, name: string | null, disabled: boolean } | null
  hasConsent: boolean
  hasLiveRefreshToken: boolean
}

export type PatAccessRow = {
  pat: { id: string, tokenHash: string, revokedAt: Date | null, expiresAt?: Date | null, upstreamIds?: string[] | null }
  user: UserRow
}

export interface AccessStore {
  loadOAuthAccess(userId: string, clientId: string, now: Date): Promise<OAuthAccessRow>
  loadPatAccess(tokenHash: string): Promise<PatAccessRow | null>
  touchConnection(userId: string, clientId: string, now: Date): Promise<void>
  touchPat(patId: string, now: Date): Promise<void>
}

export type GuardDeps = {
  resource: string // BASE_URL + '/mcp'
  resourceMetadataUrl: string
  verifyAccessToken(token: string): Promise<VerifiedAccessToken | null>
  store: AccessStore
  now?: () => Date
  onError?: (e: unknown) => void
}

export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return m ? m[1]! : null
}

export function isBanned(user: UserRow, now: Date): boolean {
  return user.banned && (user.banExpires === null || user.banExpires.getTime() > now.getTime())
}

/** One throttle per process; `last_used_at` at most once per minute and key. */
export function createAccessGuard(deps: GuardDeps) {
  const now = deps.now ?? (() => new Date())
  const allowTouch = createUseThrottle(() => now().getTime())
  const fireAndForget = (p: Promise<void>) => { p.catch(e => deps.onError?.(e)) }
  const denied = (description: string) => unauthorized(deps.resourceMetadataUrl, { error: 'invalid_token', description })

  async function authenticatePat(token: string): Promise<AuthContext | Response> {
    const hash = hashPat(token)
    const row = await deps.store.loadPatAccess(hash)
    const a = Buffer.from(hash)
    const b = Buffer.from(row?.pat.tokenHash ?? '')
    if (!row || a.length !== b.length || !timingSafeEqual(a, b)) return denied('unknown token')
    if (row.pat.revokedAt || isBanned(row.user, now())) return denied('token revoked')
    if (row.pat.expiresAt && row.pat.expiresAt.getTime() <= now().getTime()) return denied('token expired')
    if (allowTouch(`pat:${row.pat.id}`)) fireAndForget(deps.store.touchPat(row.pat.id, now()))
    return {
      userId: row.user.id, role: row.user.role, tokenType: 'pat', tokenId: row.pat.id,
      clientId: null, clientName: null, scopes: [SCOPE_MCP_TOOLS], expiresAt: row.pat.expiresAt ? Math.floor(row.pat.expiresAt.getTime() / 1000) : null, resource: deps.resource,
      ...(row.pat.upstreamIds ? { upstreamIds: row.pat.upstreamIds } : {}),
    }
  }

  async function authenticateOAuth(token: string): Promise<AuthContext | Response> {
    const claims = await deps.verifyAccessToken(token)
    if (!claims) return denied('invalid or expired token')
    if (!claims.audience.includes(deps.resource)) return denied('token audience does not match this resource')

    // Additional check on every request, also for still-valid JWTs.
    const t = now()
    const row = await deps.store.loadOAuthAccess(claims.userId, claims.clientId, t)
    if (!row.user || isBanned(row.user, t)) return denied('user is not active')
    if (!row.client || row.client.disabled) return denied('client is not active')
    if (!row.hasConsent) return denied('consent was revoked')
    // Always check (offline_access is a required scope, R15): without a live refresh token no access.
    if (!row.hasLiveRefreshToken) return denied('refresh token was revoked')

    if (!claims.scopes.includes(SCOPE_MCP_TOOLS)) return forbidden(deps.resourceMetadataUrl)
    if (allowTouch(`oauth:${claims.userId}:${claims.clientId}`)) fireAndForget(deps.store.touchConnection(claims.userId, claims.clientId, t))
    return {
      userId: row.user.id, role: row.user.role, tokenType: 'oauth', tokenId: claims.jti ?? `${claims.clientId}:${claims.userId}`,
      clientId: claims.clientId, clientName: sanitizeClientName(row.client.name) || null,
      scopes: claims.scopes, expiresAt: claims.expiresAt, resource: deps.resource,
    }
  }

  /** `AuthContext` on success, otherwise the finished 401/403 response. Errors of the dependencies lead to 500 without details. */
  return async function authenticateMcpRequest(request: Request): Promise<{ ctx: AuthContext, token: string } | Response> {
    const token = bearerToken(request)
    if (!token) return unauthorized(deps.resourceMetadataUrl)
    try {
      const result = isPatToken(token) ? await authenticatePat(token) : await authenticateOAuth(token)
      return result instanceof Response ? result : { ctx: result, token }
    } catch (e) {
      deps.onError?.(e)
      return new Response(JSON.stringify({ error: 'server_error' }), { status: 500, headers: { 'content-type': 'application/json' } })
    }
  }
}
