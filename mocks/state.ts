import type { AdminSettings, AdminUser, AllowlistEntry, AuditItem, ConnectionSummary, DcrMode, InviteSummary, OAuthClientAdmin, PatSummary, UpstreamDetail, UpstreamToolItem } from '#shared/api-types'
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
    settings: { 'stdio.enabled': true, 'ssrf.allow': [] }, audit: seed.seedAudit(), stdioDrafts: [],
  }
}

let state: MockState | null = null
/** Einmal-Token der laufenden Seite; nie persistiert (Secrets-Regel). */
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
/** E-Mail-Versand im Mock: localStorage `mockMail` = `off` schaltet ihn ab (Default: an). */
export function mailEnabled(): boolean { return store()?.getItem('mockMail') !== 'off' }
/** Registrierung ohne Einladung (Mock): localStorage `mockRegistration` = `open` simuliert eine frische Instanz ohne Nutzer. */
export function registrationOpen(): boolean { return store()?.getItem('mockRegistration') === 'open' }
export function role(): MockRole { return (store()?.getItem('mockRole') as MockRole) || 'admin' }
export function currentUser() {
  const s = getState()
  const u = s.users.find(x => x.role === role()) ?? s.users[0]!
  return u
}
