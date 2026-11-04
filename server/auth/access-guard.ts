/**
 * Token-Pruefung und Zugriffs-Check pro /mcp-Request (Plan 0b, Aufgabe 6).
 * Alle Abhaengigkeiten sind injiziert: der Token-Verifizierer (Better Auth, 0a) und der DB-Zugriff
 * (`AccessStore`). Kein Caching: Widerruf wirkt beim naechsten Request.
 */
import { timingSafeEqual } from 'node:crypto'
import { forbidden, unauthorized } from '../mcp/errors'
import type { AuthContext } from './auth-context'
import { createUseThrottle } from './client-meta'
import { hashPat, isPatToken } from './pat'
import { SCOPE_MCP_TOOLS } from './scopes'
import { sanitizeClientName } from './dcr-policy'

/** Geprueftes JWT (Signatur, Issuer, Ablauf bereits durch den Verifizierer). `null` = ungueltig. */
export type VerifiedAccessToken = {
  userId: string
  clientId: string
  scopes: string[]
  audience: string[]
  expiresAt: number // Unix-Sekunden
  jti?: string
}

export type UserRow = { id: string, role: 'admin' | 'user', banned: boolean, banExpires: Date | null }

/** Ergebnis der (zusammengefassten) indizierten Abfrage fuer OAuth-Tokens. */
export type OAuthAccessRow = {
  user: UserRow | null
  client: { id: string, name: string | null, disabled: boolean } | null
  hasConsent: boolean
  hasLiveRefreshToken: boolean
}

export type PatAccessRow = {
  pat: { id: string, tokenHash: string, revokedAt: Date | null }
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

/** Eine Drosselung je Prozess; `last_used_at` hoechstens einmal pro Minute und Schluessel. */
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
    if (allowTouch(`pat:${row.pat.id}`)) fireAndForget(deps.store.touchPat(row.pat.id, now()))
    return {
      userId: row.user.id, role: row.user.role, tokenType: 'pat', tokenId: row.pat.id,
      clientId: null, clientName: null, scopes: [SCOPE_MCP_TOOLS], expiresAt: null, resource: deps.resource,
    }
  }

  async function authenticateOAuth(token: string): Promise<AuthContext | Response> {
    const claims = await deps.verifyAccessToken(token)
    if (!claims) return denied('invalid or expired token')
    if (!claims.audience.includes(deps.resource)) return denied('token audience does not match this resource')

    // Zusatzpruefung bei jedem Request, auch fuer noch gueltige JWT.
    const t = now()
    const row = await deps.store.loadOAuthAccess(claims.userId, claims.clientId, t)
    if (!row.user || isBanned(row.user, t)) return denied('user is not active')
    if (!row.client || row.client.disabled) return denied('client is not active')
    if (!row.hasConsent) return denied('consent was revoked')
    // Ohne offline_access gibt es keinen Refresh-Token; dann zaehlt allein der Consent (Plan, offener Punkt).
    if (claims.scopes.includes('offline_access') && !row.hasLiveRefreshToken) return denied('refresh token was revoked')

    if (!claims.scopes.includes(SCOPE_MCP_TOOLS)) return forbidden(deps.resourceMetadataUrl)
    if (allowTouch(`oauth:${claims.userId}:${claims.clientId}`)) fireAndForget(deps.store.touchConnection(claims.userId, claims.clientId, t))
    return {
      userId: row.user.id, role: row.user.role, tokenType: 'oauth', tokenId: claims.jti ?? `${claims.clientId}:${claims.userId}`,
      clientId: claims.clientId, clientName: sanitizeClientName(row.client.name) || null,
      scopes: claims.scopes, expiresAt: claims.expiresAt, resource: deps.resource,
    }
  }

  /** `AuthContext` bei Erfolg, sonst die fertige 401/403-Antwort. Fehler der Abhaengigkeiten fuehren zu 500 ohne Details. */
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
