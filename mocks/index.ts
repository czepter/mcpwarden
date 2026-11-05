import { ALL_DOMAINS, type Domain } from './util'
import { authHandlers } from './handlers/auth'
import { oauthHandlers } from './handlers/oauth'
import { meHandlers } from './handlers/me'
import { adminHandlers } from './handlers/admin'
import { upstreamHandlers } from './handlers/upstreams'
import { auditHandlers, dashboardHandlers, linkHandlers, statsHandlers } from './handlers/misc'

/** Domaene -> Handler. admin-oauth gehoert zu den Admin-Handlern (/api/admin/oauth/*). */
const BY_DOMAIN: Record<Domain, unknown[]> = {
  'auth': authHandlers, 'oauth': oauthHandlers, 'me': meHandlers, 'admin-oauth': [], 'admin': adminHandlers,
  'upstreams': upstreamHandlers, 'audit': auditHandlers, 'dashboard': dashboardHandlers, 'stats': statsHandlers, 'links': linkHandlers,
}

/** `all` oder Liste wie `auth,oauth,me`. Einzige Stelle, die Domaenen auswaehlt. */
export function activeDomains(spec: string | undefined): Domain[] {
  if (!spec) return []
  if (spec === 'all' || spec === 'true') return ALL_DOMAINS
  return spec.split(',').map(s => s.trim()).filter((s): s is Domain => (ALL_DOMAINS as string[]).includes(s))
}
export function handlersFor(spec: string | undefined) {
  const d = activeDomains(spec)
  // admin-oauth und admin teilen eine Datei; "admin" schliesst /api/admin/oauth ein, "admin-oauth" allein liefert alle Admin-Routen.
  const set = new Set<unknown>()
  d.forEach(x => (x === 'admin-oauth' ? adminHandlers : BY_DOMAIN[x]).forEach(h => set.add(h)))
  return [...set] as never[]
}
export * from './state'
