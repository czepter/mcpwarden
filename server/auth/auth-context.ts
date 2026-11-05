/** Auth-Kontext pro /mcp-Request (Plan 0b, Abschnitt 10). Wird vom Gate erzeugt, im SDK als `authInfo.extra` gefuehrt. */
import type { AuthInfo } from '@modelcontextprotocol/server'

export type AuthContext = {
  userId: string // user.id aus Better Auth (Text); Basis jeder Query (Mandantentrennung)
  role: 'admin' | 'user'
  tokenType: 'oauth' | 'pat'
  tokenId: string // oauth: jti bzw. Client/Nutzer-Referenz, pat: PAT-ID
  clientId: string | null // oauth: client_id, pat: null
  clientName: string | null // untrusted, gekuerzt
  scopes: string[]
  expiresAt: number | null // Unix-Sekunden; PAT: null
  resource: string // BASE_URL + '/mcp'
}

const KEY = 'authContext'

export function toAuthInfo(ctx: AuthContext, token: string): AuthInfo {
  return {
    token,
    clientId: ctx.clientId ?? `pat:${ctx.tokenId}`,
    scopes: ctx.scopes,
    ...(ctx.expiresAt !== null ? { expiresAt: ctx.expiresAt } : {}),
    resource: new URL(ctx.resource),
    extra: { [KEY]: ctx },
  }
}

export function getAuthContext(authInfo: AuthInfo | undefined): AuthContext {
  const ctx = authInfo?.extra?.[KEY] as AuthContext | undefined
  if (!ctx) throw new Error('missing auth context')
  return ctx
}
