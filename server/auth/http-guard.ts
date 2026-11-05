/**
 * Better Auth endpoints that are never reachable via HTTP (`/api/auth/**`). They bypass mcpwarden checks:
 *  - `/admin/**` (admin() plugin): impersonation, setting password/role, creating/changing/deleting/banning users bypass
 *    `guardTarget` (last admin, self-target), the cleanup handlers (pool, worker, tokens) and the audit.
 *  - Client management of the OAuth provider (`create-client`, `update-client`, ...): bypasses the DCR policy (only `/oauth2/register`
 *    is gated) and the client management under `/api/admin/oauth/**`.
 * Only server-side calls remain allowed (`auth.api.*` without a request, see server/gateway/auth-admin.ts).
 */
const BLOCKED: RegExp[] = [
  /^\/admin(\/|$)/,
  /^\/oauth2\/(create-client|update-client|delete-client|update-consent|delete-consent)$/,
  /^\/oauth2\/client\/rotate-secret$/,
]

/** `path` is the endpoint path relative to the basePath (e.g. `/admin/ban-user`). */
export function isBlockedOverHttp(path: string): boolean {
  const p = path.toLowerCase().replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
  return BLOCKED.some(r => r.test(p))
}
