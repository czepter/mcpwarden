import type {
  AdminUserLimitsInput, AdminSettings, AdminSettingsResult, AdminUserList, AllowlistEntry, AllowlistInput, AllowlistList,
  AuditList, AuthSession, Capabilities, PublicConfig, MeSettings, ConnectionList, ConsentInfo, Dashboard, DcrMode, DcrPolicy, InviteInfo, InviteCreated,
  InviteList, LinkInfo, LinkTestResult, OAuthClientAdminList, PatCreated, PatList, SecretInput, SecretResult,
  StatsSummary, StatsWindow, StdioDraft, UpstreamTestResult, UpstreamToolList, UpstreamDetail, UpstreamInput, UpstreamList, UpstreamPatch, UpstreamToolItem, AdminUser,
} from '#shared/api-types'
import { API_PATHS } from '#shared/api-types'
import { del, get, http, patch, post, put } from './http'

const enc = encodeURIComponent

export const authApi = {
  session: () => http<AuthSession>('GET', API_PATHS.session, { skip401: true }),
  signIn: (email: string, password: string) => http<unknown>('POST', API_PATHS.signIn, { body: { email, password }, skip401: true }),
  signUp: (b: { name: string, email: string, password: string }, inviteToken?: string) =>
    http<unknown>('POST', API_PATHS.signUp, { body: b, headers: inviteToken ? { 'X-Invite-Token': inviteToken } : undefined, skip401: true }),
  signOut: () => post<unknown>(API_PATHS.signOut),
  updateName: (name: string) => post<unknown>('/api/auth/update-user', { name }),
  changePassword: (currentPassword: string, newPassword: string) => post<unknown>('/api/auth/change-password', { currentPassword, newPassword, revokeOtherSessions: false }),
  listSessions: () => get<Array<{ id: string, token: string, userAgent: string | null, ipAddress: string | null, createdAt: string, current: boolean }>>('/api/auth/list-sessions'),
  revokeSession: (token: string) => post<unknown>('/api/auth/revoke-session', { token }),
  registrationOpen: () => get<{ open: boolean }>('/api/auth/registration-state'),
  // Ohne redirectTo: der Link in der Mail entsteht serverseitig aus BASE_URL. Antwort ist immer gleich (kein Hinweis, ob die Adresse existiert).
  requestPasswordReset: (email: string) => http<{ status: boolean }>('POST', API_PATHS.requestPasswordReset, { body: { email }, skip401: true }),
  resetPassword: (token: string, newPassword: string) => http<{ status: boolean }>('POST', API_PATHS.resetPassword, { body: { token, newPassword }, skip401: true }),
}

export const publicApi = { config: () => http<PublicConfig>('GET', API_PATHS.publicConfig, { skip401: true }) }

export const oauthApi = {
  consentInfo: (query: string) => get<ConsentInfo>(`/api/oauth/consent-info${query}`),
  // ponytail: Better-Auth oauth2.consent, Pfad unverifiziert; Server vergibt nur die gewaehlten Scopes.
  consent: (accept: boolean, scope: string[], query: string) =>
    post<{ redirectURI?: string, url?: string }>('/api/auth/oauth2/consent', { accept, scope: scope.join(' '), oauth_query: query.replace(/^\?/, '') }),
}

export const meApi = {
  capabilities: () => get<Capabilities>(API_PATHS.capabilities),
  settings: () => get<MeSettings>(API_PATHS.meSettings),
  patchSettings: (b: Partial<MeSettings>) => patch<MeSettings>(API_PATHS.meSettings, b),
  pats: () => get<PatList>(API_PATHS.pats),
  createPat: (name: string) => post<PatCreated>(API_PATHS.pats, { name }),
  revokePat: (id: string) => del(`${API_PATHS.pats}/${enc(id)}`),
  connections: () => get<ConnectionList>(API_PATHS.connections),
  revokeConnection: (clientId: string) => del(`${API_PATHS.connections}/${enc(clientId)}`),
}

export const upstreamApi = {
  list: () => get<UpstreamList>(API_PATHS.upstreams),
  get: (id: string) => get<UpstreamDetail>(`${API_PATHS.upstreams}/${enc(id)}`),
  create: (b: UpstreamInput) => post<UpstreamDetail>(API_PATHS.upstreams, b),
  patch: (id: string, b: UpstreamPatch) => patch<UpstreamDetail>(`${API_PATHS.upstreams}/${enc(id)}`, b),
  remove: (id: string) => del(`${API_PATHS.upstreams}/${enc(id)}`),
  putSecret: (id: string, b: SecretInput) => put<SecretResult>(`${API_PATHS.upstreams}/${enc(id)}/secret`, b),
  test: (id: string) => post<UpstreamTestResult>(`${API_PATHS.upstreams}/${enc(id)}/test`),
  tools: (id: string) => get<UpstreamToolList>(`${API_PATHS.upstreams}/${enc(id)}/tools`),
  setTool: (id: string, name: string, enabled: boolean) => put<UpstreamToolItem>(`${API_PATHS.upstreams}/${enc(id)}/tools/${enc(name)}`, { enabled }),
  draft: (id: string) => get<StdioDraft>(`${API_PATHS.upstreams}/${enc(id)}/draft`), // Phase 2, Vorschlag
  approve: (id: string) => post<{ status: string }>(`${API_PATHS.upstreams}/${enc(id)}/approve`),
}

export const adminApi = {
  users: () => get<AdminUserList>('/api/admin/users'),
  ban: (id: string, reason?: string) => post<undefined>(`/api/admin/users/${enc(id)}/ban`, { reason }),
  unban: (id: string) => post<undefined>(`/api/admin/users/${enc(id)}/unban`),
  removeUser: (id: string) => del(`/api/admin/users/${enc(id)}`),
  setLimits: (id: string, b: AdminUserLimitsInput) => put<AdminUser>(`/api/admin/users/${enc(id)}/limits`, b),
  invites: () => get<InviteList>('/api/admin/invites'),
  createInvite: (email?: string, sendMail?: boolean) => post<InviteCreated>('/api/admin/invites', email ? { email, ...(sendMail ? { sendMail: true } : {}) } : {}),
  revokeInvite: (id: string) => del(`/api/admin/invites/${enc(id)}`),
  settings: () => get<AdminSettings>('/api/admin/settings'),
  putSettings: (b: Partial<AdminSettings>) => put<AdminSettingsResult>('/api/admin/settings', b),
  policy: () => get<DcrPolicy>('/api/admin/oauth/policy'),
  setPolicy: (mode: DcrMode) => put<DcrPolicy>('/api/admin/oauth/policy', { mode }),
  allowlist: () => get<AllowlistList>('/api/admin/oauth/allowlist'),
  addAllow: (b: AllowlistInput) => post<AllowlistEntry>('/api/admin/oauth/allowlist', b),
  removeAllow: (id: string) => del(`/api/admin/oauth/allowlist/${enc(id)}`),
  resetAllow: () => post<AllowlistList>('/api/admin/oauth/allowlist/reset-builtins'),
  clients: () => get<OAuthClientAdminList>('/api/admin/oauth/clients'),
  revokeClient: (id: string) => del(`/api/admin/oauth/clients/${enc(id)}`),
}

export const inviteApi = { check: (token: string) => http<InviteInfo>('GET', `/api/invites/${enc(token)}`, { skip401: true }) }
export const auditApi = { list: (q: { category?: string, cursor?: string, limit?: number }) => get<AuditList>(API_PATHS.audit, q) }
export const dashboardApi = { get: () => get<Dashboard>(API_PATHS.dashboard) }
export const statsApi = { summary: (window: StatsWindow, upstream?: string) => get<StatsSummary>('/api/stats/summary', { window, upstream }) }
export const linkApi = {
  get: (token: string) => http<LinkInfo>('GET', `/api/links/${enc(token)}`, { skip401: true }),
  test: (token: string, value: string) => post<LinkTestResult>(`/api/links/${enc(token)}/test`, { value }),
  submit: (token: string, value: string, headerName?: string) => post<{ ok: boolean }>(`/api/links/${enc(token)}/submit`, { value, headerName }),
}
