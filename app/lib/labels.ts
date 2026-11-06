import type { CallOutcome, DcrMode, StdioReason, UpstreamStatus, UpstreamSetup, UpstreamType } from '#shared/api-types'
import { t } from '~/lib/i18n'

// Unknown enum values show the raw value (fallback). Keys are looked up lazily so labels follow the active locale.
const pick = (ns: string, known: readonly string[], v: string) => known.includes(v) ? t(`common.${ns}.${v}`) : v

export const HEALTH_VALUES: UpstreamStatus[] = ['healthy', 'degraded', 'open', 'auth_expired', 'disabled', 'unknown']
export const healthLabel = (v: string) => pick('health', HEALTH_VALUES, v)

export const SETUP_VALUES: UpstreamSetup[] = ['ready', 'awaiting_auth', 'awaiting_approval']
export const setupLabel = (v: string) => pick('setup', SETUP_VALUES, v)

export const OUTCOME_VALUES: CallOutcome[] = ['ok', 'tool_error', 'timeout', 'upstream_error', 'rate_limited', 'breaker_open', 'denied']
export const outcomeLabel = (v: string) => pick('outcome', OUTCOME_VALUES, v)

export const scopeLabel = (v: string) => pick('scope', ['mcp:tools', 'mcpwarden:admin', 'openid', 'offline_access'], v)

export const typeLabel = (v: UpstreamType | string) => ({ http: 'HTTP', stdio: 'stdio' } as Record<string, string>)[v] ?? v
export const authTypeLabel = (v: string) => pick('authType', ['none', 'bearer', 'header', 'oauth'], v)
export const dcrModeLabel = (v: DcrMode) => t(`common.dcrMode.${v}`)
export const roleLabel = (v: string) => pick('role', ['admin', 'user'], v)

export const stdioReasonLabel = (v: StdioReason | string) => pick('stdioReason', ['instance_disabled', 'not_granted', 'no_capabilities', 'supervisor_unreachable', 'image_slim'], v)

export function toolKind(a?: { readOnlyHint?: boolean, destructiveHint?: boolean }): string {
  const k = !a ? 'unknown' : a.destructiveHint ? 'delete' : a.readOnlyHint ? 'read' : a.readOnlyHint === false ? 'write' : 'unknown'
  return t(`common.toolKind.${k}`)
}

export const auditActionLabel = (v: string) => v
export const inviteStatusLabel = (v: string) => pick('inviteStatus', ['open', 'used', 'expired', 'revoked'], v)
export const auditResultLabel = (v: string) => pick('auditResult', ['success', 'pending', 'denied', 'status_change'], v)
