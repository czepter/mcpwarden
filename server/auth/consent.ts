/** Reine Consent-Logik (Plan 0b, Aufgabe 4): Scope-Auswahl, Redirect-Aufbereitung, `ConsentInfo`. */
import type { ConsentInfo, ConsentRedirect, ConsentScope } from '../../shared/api-types'
import { isAllowlisted, redirectHost, redirectKind, sanitizeClientName, type AllowlistPattern } from './dcr-policy'
import { SCOPE_ADMIN, SCOPE_MCP_TOOLS, SCOPES_SUPPORTED } from './scopes'

export function consentRedirect(uri: string): ConsentRedirect {
  const kind = redirectKind(uri)
  return { uri, host: redirectHost(uri), kind, loopback: kind === 'loopback' }
}

/**
 * Angebotene Scopes: die angeforderten, gefiltert auf bekannte. Pflicht sind alle bis auf den
 * Admin-Scope, der nur erscheint, wenn er aktiviert ist (0b: nie) und dann abwaehlbar ist.
 */
export function buildConsentScopes(requested: readonly string[], adminEnabled = false): ConsentScope[] {
  const out: ConsentScope[] = SCOPES_SUPPORTED.filter(s => requested.includes(s)).map(name => ({ name, required: true }))
  if (adminEnabled && requested.includes(SCOPE_ADMIN)) out.push({ name: SCOPE_ADMIN, required: false })
  return out
}

/**
 * Zustimmung mit Teilmenge: nur angebotene Scopes, `mcp:tools` und alle Pflicht-Scopes sind
 * unverzichtbar. `granted` ist die deduplizierte Schnittmenge; nur sie darf vergeben werden.
 * Die Fehlermeldung wiederholt nie angreiferkontrollierten Text.
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
