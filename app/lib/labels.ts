import type { CallOutcome, DcrMode, StdioReason, UpstreamStatus, UpstreamSetup, UpstreamType } from '#shared/api-types'

// Unknown enum values show the raw value (fallback).
const pick = <T extends string>(map: Record<string, string>, v: T | string) => map[v] ?? v

export const HEALTH_VALUES: UpstreamStatus[] = ['healthy', 'degraded', 'open', 'auth_expired', 'disabled', 'unknown']
export const healthLabel = (v: string) => pick({
  healthy: 'In Ordnung', degraded: 'Eingeschränkt', open: 'Breaker offen', auth_expired: 'Auth abgelaufen', disabled: 'Deaktiviert', unknown: 'Unbekannt',
}, v)

export const SETUP_VALUES: UpstreamSetup[] = ['ready', 'awaiting_auth', 'awaiting_approval']
export const setupLabel = (v: string) => pick({ ready: 'Bereit', awaiting_auth: 'Wartet auf Anmeldedaten', awaiting_approval: 'Wartet auf Freigabe' }, v)

export const OUTCOME_VALUES: CallOutcome[] = ['ok', 'tool_error', 'timeout', 'upstream_error', 'rate_limited', 'breaker_open', 'denied']
export const outcomeLabel = (v: string) => pick({
  ok: 'Erfolgreich', tool_error: 'Tool-Fehler', timeout: 'Timeout', upstream_error: 'Upstream-Fehler', rate_limited: 'Rate-Limit', breaker_open: 'Breaker offen', denied: 'Abgelehnt',
}, v)

export const scopeLabel = (v: string) => pick({
  'mcp:tools': 'Tools auflisten und aufrufen', 'mcpwarden:admin': 'Upstreams verwalten', 'openid': 'Anmeldung', 'offline_access': 'Angemeldet bleiben',
}, v)

export const typeLabel = (v: UpstreamType | string) => pick({ http: 'HTTP', stdio: 'stdio' }, v)
export const authTypeLabel = (v: string) => pick({ none: 'Keine', bearer: 'Bearer-Token', header: 'Eigener Header', oauth: 'OAuth' }, v)
export const dcrModeLabel = (v: DcrMode) => ({ off: 'Aus', allowlist: 'Nur Allowlist', open: 'Offen mit Warnung' })[v]
export const roleLabel = (v: string) => pick({ admin: 'Admin', user: 'Nutzer' }, v)

export const stdioReasonLabel = (v: StdioReason | string) => pick({
  instance_disabled: 'stdio ist auf dieser Instanz ausgeschaltet. Ein Admin kann es unter Admin › Instanz aktivieren.',
  not_granted: 'Dein Konto ist für stdio nicht freigegeben. Frag einen Admin.',
  no_capabilities: 'Der Container hat keine Rechte, Prozesse sicher zu isolieren.',
  supervisor_unreachable: 'Der Supervisor ist nicht erreichbar.',
  image_slim: 'Dieses Image („slim“) enthält keine stdio-Laufzeit.',
}, v)

export function toolKind(a?: { readOnlyHint?: boolean, destructiveHint?: boolean }): 'lesend' | 'schreibend' | 'löschend' | 'unbekannt' {
  if (!a) return 'unbekannt'
  if (a.destructiveHint) return 'löschend'
  if (a.readOnlyHint) return 'lesend'
  if (a.readOnlyHint === false) return 'schreibend'
  return 'unbekannt'
}

export const auditActionLabel = (v: string) => v
export const inviteStatusLabel = (v: string) => pick({ open: 'Offen', used: 'Verwendet', expired: 'Abgelaufen', revoked: 'Widerrufen' }, v)
export const auditResultLabel = (v: string) => pick({ success: 'Erfolgreich', pending: 'Wartet auf Freigabe', denied: 'Abgelehnt', status_change: 'Statuswechsel' }, v)
