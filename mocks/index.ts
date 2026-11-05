import { ALL_DOMAINS, type Domain } from './util'
import { authHandlers } from './handlers/auth'
import { oauthHandlers } from './handlers/oauth'
import { meHandlers } from './handlers/me'
import { adminHandlers } from './handlers/admin'
import { upstreamHandlers } from './handlers/upstreams'
import { auditHandlers, dashboardHandlers, linkHandlers, statsHandlers } from './handlers/misc'

/** Domain -> handlers. admin-oauth belongs to the admin handlers (/api/admin/oauth/*). */
const BY_DOMAIN: Record<Domain, unknown[]> = {
  'auth': authHandlers, 'oauth': oauthHandlers, 'me': meHandlers, 'admin-oauth': [], 'admin': adminHandlers,
  'upstreams': upstreamHandlers, 'audit': auditHandlers, 'dashboard': dashboardHandlers, 'stats': statsHandlers, 'links': linkHandlers,
}

/** `all` or a list like `auth,oauth,me`. The only place that selects domains. */
export function activeDomains(spec: string | undefined): Domain[] {
  if (!spec) return []
  if (spec === 'all' || spec === 'true') return ALL_DOMAINS
  return spec.split(',').map(s => s.trim()).filter((s): s is Domain => (ALL_DOMAINS as string[]).includes(s))
}
export function handlersFor(spec: string | undefined) {
  const d = activeDomains(spec)
  // admin-oauth and admin share a file; "admin" includes /api/admin/oauth, "admin-oauth" alone delivers all admin routes.
  const set = new Set<unknown>()
  d.forEach(x => (x === 'admin-oauth' ? adminHandlers : BY_DOMAIN[x]).forEach(h => set.add(h)))
  return [...set] as never[]
}
export * from './state'
