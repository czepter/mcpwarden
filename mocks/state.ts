import type { AdminSettings, AdminUser, AllowlistEntry, AuditItem, ConnectionSummary, DcrMode, InviteSummary, OAuthClientAdmin, PatSummary, StdioReason, UpstreamDetail, UpstreamToolItem } from '#shared/api-types'
import * as seed from './seed'

export type MockScenario = 'default' | 'empty' | 'error' | 'slow' | 'forbidden' | 'huge'
export type MockRole = 'admin' | 'user'

export type MockState = {
  signedIn: boolean
  upstreams: UpstreamDetail[]
  tools: Record<string, UpstreamToolItem[]>
  users: AdminUser[]
  invites: InviteSummary[]
  pats: PatSummary[]
  connections: ConnectionSummary[]
  allowlist: AllowlistEntry[]
  oauthClients: OAuthClientAdmin[]
  dcrMode: DcrMode
  settings: AdminSettings
  audit: AuditItem[]
  stdioDrafts: string[]
  /** Personal setting (GET/PATCH /api/me/settings); missing in older session states = on. */
  notifyStatusMail?: boolean
}

const KEY = 'mcpwarden.mock.state'
const hasStorage = () => typeof sessionStorage !== 'undefined'
const store = () => (typeof localStorage !== 'undefined' ? localStorage : null)

function fresh(): MockState {
  const upstreams = seed.seedUpstreams()
  return {
    signedIn: false, upstreams, tools: Object.fromEntries(upstreams.map(u => [u.id, seed.seedTools(u)])),
    users: seed.seedUsers(), invites: seed.seedInvites(), pats: seed.seedPats(), connections: seed.seedConnections(),
    allowlist: seed.seedAllowlist(), oauthClients: seed.seedOAuthClients(), dcrMode: 'open',
    settings: { 'stdio.enabled': true, 'ssrf.allow': [] }, audit: seed.seedAudit(), stdioDrafts: [], notifyStatusMail: true,
  }
}

let state: MockState | null = null
/** One-time token of the running page; never persisted (secrets rule). */
export const volatileInviteTokens = new Map<string, string>()

export function getState(): MockState {
  if (state) return state
  if (hasStorage()) {
    try { const raw = sessionStorage.getItem(KEY); if (raw) { state = JSON.parse(raw) as MockState; return state } } catch { /* neu */ }
  }
  state = fresh()
  return state
}
export function save() { if (hasStorage() && state) sessionStorage.setItem(KEY, JSON.stringify(state)) }
export function resetState() { state = fresh(); volatileInviteTokens.clear(); save() }

export function scenario(): MockScenario { return (store()?.getItem('mockScenario') as MockScenario) || 'default' }
/** Email sending in the mock: localStorage `mockMail` = `off` switches it off (default: on). */
export function mailEnabled(): boolean { return store()?.getItem('mockMail') !== 'off' }
/** Registration without invitation (mock): localStorage `mockRegistration` = `open` simulates a fresh instance without users. */
export function registrationOpen(): boolean { return store()?.getItem('mockRegistration') === 'open' }
/** Forced stdio block reason (mock): localStorage `mockStdioReason` = one of the `StdioReason` values, e.g. `image_slim`. */
export function stdioReasonOverride(): StdioReason | null {
  const v = store()?.getItem('mockStdioReason')
  return v && ['instance_disabled', 'not_granted', 'no_capabilities', 'supervisor_unreachable', 'image_slim'].includes(v) ? v as StdioReason : null
}
export function role(): MockRole { return (store()?.getItem('mockRole') as MockRole) || 'admin' }
export function currentUser() {
  const s = getState()
  const u = s.users.find(x => x.role === role()) ?? s.users[0]!
  return u
}
