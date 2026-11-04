/** Scope-Konstanten (Plan 0b, Annahme 10). `mcpwarden:admin` ist reserviert und in 0b nicht wirksam. */
export const SCOPE_MCP_TOOLS = 'mcp:tools'
export const SCOPE_ADMIN = 'mcpwarden:admin'
export const SCOPES_SUPPORTED = ['openid', 'offline_access', SCOPE_MCP_TOOLS] as const
export const ACCESS_TOKEN_TTL_SECONDS = 300
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600

/** Scope-Strings eines OAuth-Parameters (leerzeichengetrennt) ohne Duplikate. */
export function parseScopeString(scope: string | undefined | null): string[] {
  return [...new Set((scope ?? '').split(/\s+/).filter(Boolean))]
}
