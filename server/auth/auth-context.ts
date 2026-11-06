/** Auth context per /mcp request (plan 0b, section 10). Created by the gate, carried in the SDK as `authInfo.extra`. */
import type { AuthInfo } from '@modelcontextprotocol/server'

export type AuthContext = {
  userId: string // user.id from Better Auth (text); basis of every query (tenant isolation)
  role: 'admin' | 'user'
  tokenType: 'oauth' | 'pat'
  tokenId: string // oauth: jti or client/user reference, pat: PAT ID
  clientId: string | null // oauth: client_id, pat: null
  clientName: string | null // untrusted, truncated
  scopes: string[]
  expiresAt: number | null // Unix seconds; PAT: null = never expires
  resource: string // BASE_URL + '/mcp'
  upstreamIds?: string[] // PAT only: restricts to these upstreams; absent = all
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
