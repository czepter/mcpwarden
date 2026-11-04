/** Reine Consent-Logik (Plan 0b, Aufgabe 4): Scope-Auswahl, Redirect-Aufbereitung, `ConsentInfo`. */
import type { ConsentInfo, ConsentRedirect, ConsentScope } from '../../shared/api-types'
import { isAllowlisted, isLoopbackHost, redirectHost, sanitizeClientName, type AllowlistPattern } from './dcr-policy'
import { SCOPE_ADMIN, SCOPE_MCP_TOOLS, SCOPES_SUPPORTED } from './scopes'

export function consentRedirect(uri: string): ConsentRedirect {
  let loopback = false
  try {
    const url = new URL(uri)
    loopback = url.protocol === 'http:' && isLoopbackHost(url.hostname)
  } catch { /* untrusted input: unparsable bleibt non-loopback */ }
  return { uri, host: redirectHost(uri), loopback }
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

/** Zustimmung mit Teilmenge: nur angebotene Scopes, `mcp:tools` ist unverzichtbar. */
export function validateAcceptedScopes(accepted: readonly string[], offered: readonly ConsentScope[]):
  { ok: true } | { ok: false, reason: string } {
  const offeredNames = new Set(offered.map(s => s.name))
  if (!accepted.includes(SCOPE_MCP_TOOLS)) return { ok: false, reason: `scope ${SCOPE_MCP_TOOLS} is required` }
  const unknown = accepted.find(s => !offeredNames.has(s))
  if (unknown) return { ok: false, reason: `scope ${unknown} was not offered` }
  const missing = offered.find(s => s.required && !accepted.includes(s.name))
  if (missing) return { ok: false, reason: `scope ${missing.name} is required` }
  return { ok: true }
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
