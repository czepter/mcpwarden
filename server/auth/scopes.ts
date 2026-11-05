/** Scope constants (plan 0b, assumption 10). `mcpwarden:admin` is reserved and has no effect in 0b. */
export const SCOPE_MCP_TOOLS = 'mcp:tools'
export const SCOPE_ADMIN = 'mcpwarden:admin'
export const SCOPES_SUPPORTED = ['openid', 'offline_access', SCOPE_MCP_TOOLS] as const
export const ACCESS_TOKEN_TTL_SECONDS = 300
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 3600

/** Scope strings of an OAuth parameter (space-separated) without duplicates. */
export function parseScopeString(scope: string | undefined | null): string[] {
  return [...new Set((scope ?? '').split(/\s+/).filter(Boolean))]
}
