/** Pure consent logic (plan 0b, task 4): scope selection, redirect preparation, `ConsentInfo`. */
import type { ConsentInfo, ConsentRedirect, ConsentScope } from '../../shared/api-types'
import { isAllowlisted, redirectHost, redirectKind, sanitizeClientName, type AllowlistPattern } from './dcr-policy'
import { SCOPE_ADMIN, SCOPE_MCP_TOOLS, SCOPES_SUPPORTED } from './scopes'

export function consentRedirect(uri: string): ConsentRedirect {
  const kind = redirectKind(uri)
  return { uri, host: redirectHost(uri), kind, loopback: kind === 'loopback' }
}

/**
 * Offered scopes: the requested ones, filtered to known ones. All are required except the
 * admin scope, which appears only when enabled (0b: never) and can then be deselected.
 */
export function buildConsentScopes(requested: readonly string[], adminEnabled = false): ConsentScope[] {
  // offline_access and mcp:tools are required (R15): every consent produces a refresh token so that
  // its revocation takes effect immediately. All three are always granted, even if the client requests fewer.
  const out: ConsentScope[] = SCOPES_SUPPORTED.map(name => ({ name, required: true }))
  if (adminEnabled && requested.includes(SCOPE_ADMIN)) out.push({ name: SCOPE_ADMIN, required: false })
  return out
}

/**
 * Consent with a subset: only offered scopes; `mcp:tools` and all required scopes are
 * indispensable. `granted` is the deduplicated intersection; only it may be granted.
 * The error message never repeats attacker-controlled text.
 */
export function validateAcceptedScopes(accepted: readonly unknown[], offered: readonly ConsentScope[]):
  { ok: true, granted: string[] } | { ok: false, reason: string } {
  const offeredNames = new Set(offered.map(s => s.name))
  if (accepted.some(s => typeof s !== 'string' || s === '' || !offeredNames.has(s))) return { ok: false, reason: 'selection contains scopes that were not offered' }
  const granted = [...new Set(accepted as string[])]
  if (!granted.includes(SCOPE_MCP_TOOLS)) return { ok: false, reason: `scope ${SCOPE_MCP_TOOLS} is required` }
  const missing = offered.find(s => s.required && !granted.includes(s.name))
  if (missing) return { ok: false, reason: `scope ${missing.name} is required` }
  return { ok: true, granted }
}

export type ConsentClientInput = {
  id: string
  name: string | null | undefined
  redirectUris: string[]
  registeredAt: Date
  viaDcr: boolean
}

export function buildConsentInfo(input: {
  client: ConsentClientInput
  requestedScopes: readonly string[]
  allowlist: readonly AllowlistPattern[]
  baseUrl: URL
  adminScopeEnabled?: boolean
}): ConsentInfo {
  const { client } = input
  const name = sanitizeClientName(client.name)
  const redirects = client.redirectUris.map(consentRedirect)
  return {
    client: {
      id: client.id,
      name,
      redirects,
      allowlisted: isAllowlisted(input.allowlist, name, client.redirectUris),
      registeredAt: client.registeredAt.toISOString(),
      viaDcr: client.viaDcr,
    },
    scopes: buildConsentScopes(input.requestedScopes, input.adminScopeEnabled),
    resource: new URL('/mcp', input.baseUrl).href,
    loopback: redirects.some(r => r.loopback),
  }
}
