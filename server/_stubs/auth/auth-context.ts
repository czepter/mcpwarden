// TEMPORÄRER STUB für server/auth/auth-context.ts (Phase 0b, Plan phase-1 Abschnitt 3).
export type AuthContext = {
  userId: string
  tokenType: 'oauth' | 'pat'
  tokenId: string
  clientId: string | null
  clientName: string | null
  scopes: string[]
  expiresAt: number | null
  resource: string
  role: 'admin' | 'user'
}
