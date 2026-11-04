/**
 * Policy-Gate vor `POST /api/auth/oauth2/register` (Plan 0b, Aufgabe 3). Als Better-Auth-`hooks.before`/`after`
 * eingehaengt, damit auch Direktaufrufe der Plugin-Route gefiltert werden (`clientPrivileges` greift bei anonymer
 * DCR nicht, siehe mcp-plugin.ts). Fehler im Format von RFC 7591.
 */
import { APIError } from 'better-auth/api'
import type { DcrMode } from '../../shared/api-types'
import { evaluateRegistration, isAllowlisted, sanitizeClientName, type AllowlistPattern } from './dcr-policy'

export const REGISTER_PATH = '/oauth2/register'

export type DcrDeps = {
  getPolicy(): Promise<{ mode: DcrMode, allowlist: AllowlistPattern[] }>
  recordRegistration(clientId: string, allowlisted: boolean): Promise<void>
}

function metadata(body: unknown) {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : []
  return { clientName: typeof b.client_name === 'string' ? b.client_name : undefined, redirectUris: uris.filter((u): u is string => typeof u === 'string'), shapeOk: Array.isArray(b.redirect_uris) && uris.every(u => typeof u === 'string') }
}

export async function dcrBefore(path: string, body: unknown, deps: DcrDeps): Promise<void> {
  if (path !== REGISTER_PATH) return
  const { mode, allowlist } = await deps.getPolicy()
  const m = metadata(body)
  const d = evaluateRegistration(mode, allowlist, m.shapeOk ? m : { ...m, redirectUris: [] })
  if (d.allow) return
  throw new APIError(d.status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST', { error: d.error, error_description: d.reason })
}

export async function dcrAfter(path: string, body: unknown, returned: unknown, deps: DcrDeps): Promise<void> {
  if (path !== REGISTER_PATH) return
  const clientId = (returned as { client_id?: unknown } | null)?.client_id
  if (typeof clientId !== 'string') return
  const { allowlist } = await deps.getPolicy()
  const m = metadata(body)
  // Ein Fehler beim Protokollieren darf die erfolgreiche Registrierung nicht kippen (Meta fehlt dann, API rechnet live).
  await deps.recordRegistration(clientId, isAllowlisted(allowlist, sanitizeClientName(m.clientName), m.redirectUris))
    .catch(() => console.error('[mcpwarden] oauth_client_meta konnte nicht geschrieben werden'))
}
