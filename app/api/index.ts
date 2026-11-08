import type {
  AdminUserLimitsInput, AdminSettings, AdminSettingsResult, AdminUserList, AllowlistEntry, AllowlistInput, AllowlistList,
  AuditList, AuthSession, DeviceVerification, Capabilities, PublicConfig, MeSettings, ConnectionList, ConsentInfo, Dashboard, DcrMode, DcrPolicy, InviteInfo, InviteCreated,
  InviteList, LinkInfo, LinkTestResult, OAuthClientAdminList, PatCreateInput, PatCreated, PatList, SecretInput, SecretResult,
  AdminStats, HealthHistory, UpstreamStats, StatsSummary, StatsWindow, StdioDraft, UpstreamAuthProbe, UpstreamOAuthStart, UpstreamTestResult, UpstreamToolList, UpstreamDetail, UpstreamInput, UpstreamList, UpstreamPatch, UpstreamToolItem, AdminUser,
  UpstreamImportInput, UpstreamImportResult, UpstreamTagList,
} from '#shared/api-types'
import { API_PATHS } from '#shared/api-types'
import { ApiError, del, get, http, patch, post, put } from './http'

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
  // Without redirectTo: the link in the mail is built server-side from BASE_URL. The response is always the same (no hint whether the address exists).
  requestPasswordReset: (email: string) => http<{ status: boolean }>('POST', API_PATHS.requestPasswordReset, { body: { email }, skip401: true }),
  resetPassword: (token: string, newPassword: string) => http<{ status: boolean }>('POST', API_PATHS.resetPassword, { body: { token, newPassword }, skip401: true }),
}

export const publicApi = { config: () => http<PublicConfig>('GET', API_PATHS.publicConfig, { skip401: true }) }

export const oauthApi = {
  consentInfo: (query: string) => get<ConsentInfo>(`/api/oauth/consent-info${query}`),
  // Better Auth oauth2.consent (verified against the real backend by tests/smoke and tests/integration/oauth); the server grants only the chosen scopes.
  consentDevice: (deviceName: string | null, query: string) => post<unknown>('/api/oauth/consent-device', { deviceName, oauth_query: query.replace(/^\?/, '') }),
  consent: (accept: boolean, scope: string[], query: string) =>
    post<{ redirectURI?: string, url?: string }>('/api/auth/oauth2/consent', { accept, scope: scope.join(' '), oauth_query: query.replace(/^\?/, '') }),
}

// Device grant endpoints of Better Auth (RFC 8628 error format `{ error, error_description }`, hence not the shared `http`).
async function deviceCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const j = await res.json().catch(() => undefined) as { error?: string, error_description?: string, code?: string, message?: string } | undefined
  if (!res.ok) throw new ApiError(res.status, j?.error ?? j?.code ?? 'unknown', j?.error_description ?? j?.message ?? `HTTP ${res.status}`)
  return j as T
}

export const deviceApi = {
  // Looking a code up binds it to the signed-in user (only that user may approve it).
  lookup: (userCode: string) => deviceCall<DeviceVerification>('GET', `/api/auth/device?user_code=${enc(userCode)}`),
  approve: (userCode: string) => deviceCall<{ success: boolean }>('POST', '/api/auth/device/approve', { userCode }),
  deny: (userCode: string) => deviceCall<{ success: boolean }>('POST', '/api/auth/device/deny', { userCode }),
}

export const meApi = {
  capabilities: () => get<Capabilities>(API_PATHS.capabilities),
  settings: () => get<MeSettings>(API_PATHS.meSettings),
  patchSettings: (b: Partial<MeSettings>) => patch<MeSettings>(API_PATHS.meSettings, b),
  /** Self-deletion; wrong password is a 403 (not 401), so the session handler does not fire. */
  deleteAccount: (b: { password: string, confirmEmail: string }) => http<undefined>('DELETE', '/api/me', { body: b }).then(() => undefined),
  pats: () => get<PatList>(API_PATHS.pats),
  createPat: (b: PatCreateInput) => post<PatCreated>(API_PATHS.pats, b),
  revokePat: (id: string) => del(`${API_PATHS.pats}/${enc(id)}`),
  renamePat: (id: string, deviceName: string | null) => patch<unknown>(`${API_PATHS.pats}/${enc(id)}`, { deviceName }),
  connections: () => get<ConnectionList>(API_PATHS.connections),
  revokeConnection: (clientId: string) => del(`${API_PATHS.connections}/${enc(clientId)}`),
  renameConnection: (clientId: string, deviceName: string | null) => patch<unknown>(`${API_PATHS.connections}/${enc(clientId)}`, { deviceName }),
}

export const upstreamApi = {
  list: (window?: StatsWindow) => get<UpstreamList>(API_PATHS.upstreams, { window }),
  stats: (id: string, window: StatsWindow) => get<UpstreamStats>(`${API_PATHS.upstreams}/${enc(id)}/stats`, { window }),
  healthHistory: (id: string) => get<HealthHistory>(`${API_PATHS.upstreams}/${enc(id)}/health-history`),
  get: (id: string) => get<UpstreamDetail>(`${API_PATHS.upstreams}/${enc(id)}`),
  create: (b: UpstreamInput) => post<UpstreamDetail>(API_PATHS.upstreams, b),
  patch: (id: string, b: UpstreamPatch) => patch<UpstreamDetail>(`${API_PATHS.upstreams}/${enc(id)}`, b),
  remove: (id: string) => del(`${API_PATHS.upstreams}/${enc(id)}`),
  putSecret: (id: string, b: SecretInput) => put<SecretResult>(`${API_PATHS.upstreams}/${enc(id)}/secret`, b),
  tags: () => get<UpstreamTagList>(`${API_PATHS.upstreams}/tags`),
  importJson: (b: UpstreamImportInput) => post<UpstreamImportResult>(`${API_PATHS.upstreams}/import`, b),
  probe: (url: string) => post<UpstreamAuthProbe>(`${API_PATHS.upstreams}/probe`, { url }),
  oauthStart: (id: string) => post<UpstreamOAuthStart>(`${API_PATHS.upstreams}/${enc(id)}/oauth/start`),
  oauthDisconnect: (id: string) => del(`${API_PATHS.upstreams}/${enc(id)}/oauth`),
  test: (id: string) => post<UpstreamTestResult>(`${API_PATHS.upstreams}/${enc(id)}/test`),
  tools: (id: string) => get<UpstreamToolList>(`${API_PATHS.upstreams}/${enc(id)}/tools`),
  setTool: (id: string, name: string, enabled: boolean) => put<UpstreamToolItem>(`${API_PATHS.upstreams}/${enc(id)}/tools/${enc(name)}`, { enabled }),
  draft: (id: string) => get<StdioDraft>(`${API_PATHS.upstreams}/${enc(id)}/draft`), // Phase 2, proposal
  approve: (id: string) => post<{ status: string }>(`${API_PATHS.upstreams}/${enc(id)}/approve`),
}

export const adminApi = {
  users: () => get<AdminUserList>('/api/admin/users'),
  stats: (window: StatsWindow) => get<AdminStats>('/api/admin/stats', { window }),
  ban: (id: string, reason?: string) => post<undefined>(`/api/admin/users/${enc(id)}/ban`, { reason }),
  unban: (id: string) => post<undefined>(`/api/admin/users/${enc(id)}/unban`),
  removeUser: (id: string) => del(`/api/admin/users/${enc(id)}`),
  setLimits: (id: string, b: AdminUserLimitsInput) => put<AdminUser>(`/api/admin/users/${enc(id)}/limits`, b),
  invites: () => get<InviteList>('/api/admin/invites'),
  createInvite: (email?: string, sendMail?: boolean) => post<InviteCreated>('/api/admin/invites', email ? { email, ...(sendMail ? { sendMail: true } : {}) } : {}),
  revokeInvite: (id: string) => del(`/api/admin/invites/${enc(id)}`),
  settings: () => get<AdminSettingsResult>('/api/admin/settings'),
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
export const dashboardApi = { get: (window?: StatsWindow) => get<Dashboard>(API_PATHS.dashboard, { window }) }
export const statsApi = { summary: (window: StatsWindow, upstream?: string, tool?: string) => get<StatsSummary>('/api/stats/summary', { window, upstream, tool }) }
export const linkApi = {
  get: (token: string) => http<LinkInfo>('GET', `/api/links/${enc(token)}`, { skip401: true }),
  test: (token: string, value: string) => post<LinkTestResult>(`/api/links/${enc(token)}/test`, { value }),
  submit: (token: string, value: string, headerName?: string) => post<{ ok: boolean }>(`/api/links/${enc(token)}/submit`, { value, headerName }),
}
