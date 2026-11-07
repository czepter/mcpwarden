/**
 * Shared contract between the frontend (app/**) and the backend (server/**).
 * Import everywhere as `#shared/api-types`.
 *
 * Rules:
 * 1. Only types and constants; no runtime logic, no import of Vue or Nitro.
 * 2. Timestamps as ISO-8601 strings, durations in milliseconds with the suffix `Ms`,
 *    ratios as a number 0 to 1. Secrets appear in no response type (only `hasSecret: boolean`).
 * 3. Adding a field is backward compatible and needs only a note in the commit subject.
 *    Renaming or removing requires prior agreement between the frontend and the
 *    backend agent of the affected route and changes type, mock (frontend) and route in the same commit.
 * 4. Whoever builds or changes a route adds the type in the same commit and checks the response
 *    against the type with `satisfies`. Changes to the file carry the subject prefix `contract:`.
 * 5. The backend builds no response that deviates from the type; if it deviates deliberately, the type
 *    is changed (rule 3) rather than concealing the deviation.
 */

export type Role = 'admin' | 'user'

/** User in the response of `GET /api/auth/get-session` (subset of the Better Auth fields). */
export interface AuthSessionUser {
  id: string
  name: string
  email: string
  role: Role
  banned: boolean
}

/** Error shape of Nitro (`createError`); `/api/auth/*` returns `AuthErrorBody` instead. */
export interface ApiErrorBody {
  statusCode: number
  statusMessage: string
  data?: { code?: string, field?: string, message?: string }
}

/** Error shape of the Better Auth endpoints under `/api/auth/*`. */
export interface AuthErrorBody {
  code?: string
  message: string
}

/** Stable error code (HTTP 403) of `POST /api/auth/sign-up/email` when registration is locked. */
export const REGISTRATION_CLOSED = 'REGISTRATION_CLOSED'

// --- Phase 0b: OAuth provider, consent, PATs, clients (docs/plans/phase-0b.md, section 4.1) ---

export type DcrMode = 'off' | 'allowlist' | 'open'
export type DcrPolicy = { mode: DcrMode } // Standard 'open'

// Consent: name, redirect URIs, allowlist status, scopes (without titles, titles live in the frontend)
// `host` is with scheme for kind 'app' (e.g. `evil-app://claude.ai`), otherwise the bare host.
export type ConsentRedirectKind = 'web' | 'loopback' | 'app'
export type ConsentRedirect = { uri: string, host: string, kind: ConsentRedirectKind, loopback: boolean }
export type ConsentScope = { name: string, required: boolean }
export type ConsentInfo = {
  client: {
    id: string
    name: string // untrusted, truncated to 80 characters, render as text only
    redirects: ConsentRedirect[]
    allowlisted: boolean // computed live against the current allowlist
    registeredAt: string
    viaDcr: boolean
  }
  scopes: ConsentScope[] // 'mcpwarden:admin' only if enabled (never in 0b)
  resource: string // BASE_URL + '/mcp'
  loopback: boolean // at least one redirect URI is loopback (additional warning)
}

// PATs: plaintext only in PatCreated.token
export type PatSummary = {
  id: string
  name: string
  prefix: string // 'mcpw_pat_' + 4 characters
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null // null = läuft nie ab
  upstreamIds: string[] | null // null = alle Upstreams
}
export type PatList = { items: PatSummary[], limit: { max: number, active: number } } // max = 20
export type PatCreated = PatSummary & { token: string }
export type PatCreateInput = { name: string, expiresInDays?: number | null, upstreamIds?: string[] | null } // name 1 to 64 characters; expiresInDays 1 to 365 (null = never); upstreamIds null = all

// Clients of the user (UI word "Clients", path stays "connections")
export type ConnectionSummary = {
  clientId: string
  name: string
  scopes: string[]
  redirectHost: string
  allowlisted: boolean
  grantedAt: string
  lastUsedAt: string | null // last call on /mcp, throttled to 1 min precision
  active: boolean // lastUsedAt at most 5 min ago; display "Aktiv"/"Inaktiv" in the frontend
}
export type ConnectionList = { items: ConnectionSummary[] }

// Admin: allowlist and registrations
export type AllowlistEntry = {
  id: string
  label: string
  namePattern: string
  redirectPatterns: string[]
  builtin: boolean
  createdAt: string
}
export type AllowlistInput = Pick<AllowlistEntry, 'label' | 'namePattern' | 'redirectPatterns'>
export type AllowlistList = { items: AllowlistEntry[] }
export type OAuthClientAdmin = {
  id: string
  name: string
  redirectUris: string[]
  createdAt: string
  lastUsedAt: string | null
  userCount: number // number of consents
  allowlisted: boolean // live berechnet
  registeredVia: 'dcr' | 'admin'
  disabled: boolean
  expiresAt: string | null // createdAt + 30 days as long as never used; otherwise null
}
export type OAuthClientAdminList = { items: OAuthClientAdmin[] }

// --- Phase 1: upstreams, admin, audit, dashboard (docs/plans/phase-1.md, section 4.5) ---

export type UpstreamStatus = 'unknown' | 'healthy' | 'degraded' | 'open' | 'auth_expired' | 'disabled'
export type UpstreamSetup = 'ready' | 'awaiting_auth' | 'awaiting_approval'
export type UpstreamType = 'http' | 'stdio'
export type UpstreamAuthType = 'none' | 'bearer' | 'header' | 'env' | 'oauth' // 'env': stdio only, 'oauth': http only
export type UpstreamTimeouts = { connectMs: number, listMs: number, callMs: number }

export type UpstreamSummary = {
  id: string
  slug: string
  name: string
  description: string | null
  type: UpstreamType
  url: string | null
  command: string | null
  enabled: boolean
  status: UpstreamStatus
  statusReason: string | null
  statusChangedAt: string | null
  lastError: string | null
  lastOkAt: string | null
  setup: UpstreamSetup
  toolsEnabled: number
  toolsTotal: number
  nextRetryAt: string | null
  rateLimitHits5m: number
  hasSecret: boolean
  p95Ms?: number | null // Phase 2
  recent?: Array<'ok' | 'warn' | 'err' | 'none'> // Phase 2, 24 entries
}
export type UpstreamDetail = UpstreamSummary & {
  transport: 'auto' | 'streamable' | 'sse'
  authType: UpstreamAuthType
  authHeaderName: string | null
  ratePerMin: number
  maxConcurrent: number
  timeouts: UpstreamTimeouts
  args: string[]
  cwd: string | null
  env: Record<string, string>
  secretNames: string[]
  version: number
  createdAt: string
  updatedAt: string
}
export type UpstreamList = { items: UpstreamSummary[] }
export type UpstreamInput = {
  name: string
  slug: string
  type: UpstreamType
  description?: string | null
  url?: string
  transport?: 'auto' | 'streamable' | 'sse'
  authType?: UpstreamAuthType
  authHeaderName?: string | null
  ratePerMin?: number
  maxConcurrent?: number
  timeouts?: Partial<UpstreamTimeouts> | null
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string | null
}
export type UpstreamPatch = Partial<Omit<UpstreamInput, 'slug' | 'type'>> & { enabled?: boolean }
export type SecretInput = { kind: 'bearer' | 'header' | 'env', name?: string, value: string }
export type SecretResult = { hasSecret: true, setup: UpstreamSetup }
/** Where the upstream's authorization server sends the browser back (registered as redirect URI, relative to BASE_URL). */
export const UPSTREAM_OAUTH_CALLBACK_PATH = '/api/upstream-oauth/callback'
/** `authorizationUrl`: send the browser there; `null` with `connected: true` when the stored session was still valid. */
/** Result of `POST /api/upstreams/probe`: does the server offer OAuth, and can mcpwarden register itself (DCR)? */
export type UpstreamAuthProbe = { oauth: 'dcr' | 'no_dcr' | 'none' }
export type UpstreamOAuthStart = { authorizationUrl: string | null, connected: boolean }
export type UpstreamTestErrorCode = 'ssrf_blocked' | 'redirect' | 'timeout' | 'connect_failed' | 'unauthorized' | 'upstream_error' | 'protocol' | 'awaiting_auth' | 'stdio_not_allowed'
export type UpstreamTestResult =
  | { ok: true, tools: Array<{ name: string, description?: string }>, latencyMs: number }
  | { ok: false, errorCode: UpstreamTestErrorCode, message: string, latencyMs?: number }
export type UpstreamToolItem = {
  name: string
  title: string | null
  description: string | null
  enabled: boolean
  gone: boolean
  firstSeenAt: string
  lastSeenAt: string
  annotations?: { readOnlyHint?: boolean, destructiveHint?: boolean, idempotentHint?: boolean }
}
export type UpstreamToolList = { items: UpstreamToolItem[], fetchedAt: string | null, stale: boolean }

export type StdioReason = 'instance_disabled' | 'not_granted' | 'no_capabilities' | 'supervisor_unreachable' | 'image_slim'
export type Capabilities = {
  mcpUrl: string
  role: Role
  stdio: { allowed: boolean, reason?: StdioReason }
  limits: { maxUpstreams: number, upstreamsUsed: number, maxConnections: number, callsPerMin: number }
  defaults: { ratePerMin: number, maxConcurrent: number, timeouts: UpstreamTimeouts }
  features?: { toolMode?: boolean, callLog?: boolean, healthHistory?: boolean } // later phases
}

export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked'
export type InviteSummary = { id: string, email: string | null, createdAt: string, expiresAt: string, status: InviteStatus, usedAt: string | null, usedByUserId: string | null, createdByUserId: string | null }
export type InviteList = { items: InviteSummary[] }
/** `mailQueued`: the link was additionally handed over for sending to the bound address (delivery not guaranteed). */
export type InviteCreated = { id: string, email: string | null, createdAt: string, expiresAt: string, link: string, mailQueued?: boolean }
export type InviteInfo = { valid: true, email: string | null, expiresAt: string } | { valid: false, reason: 'expired' | 'used' | 'revoked' | 'unknown' }
/** Stable codes (HTTP 403) of `POST /api/auth/sign-up/email`. */
export const INVITE_REQUIRED = 'INVITE_REQUIRED'
export const INVITE_INVALID = 'INVITE_INVALID'

export type UserLimits = { maxUpstreams: number, callsPerMin: number, maxConnections: number, stdioMaxProcs: number, stdioIdleMin: number }
export type AdminUser = {
  id: string
  email: string
  name: string
  role: Role
  banned: boolean
  banReason: string | null
  createdAt: string
  upstreamCount: number
  lastActivityAt: string | null
  stdioAllowed: boolean
  limits: UserLimits
}
export type AdminUserList = { items: AdminUser[], defaults: UserLimits }
export type AdminUserLimitsInput = Partial<UserLimits & { stdioAllowed: boolean }>
export type AdminSettings = { 'stdio.enabled': boolean, 'ssrf.allow': string[] }
export type AdminSettingsResult = AdminSettings & { warnings: Array<{ key: string, entry: string, code: 'covers_metadata_ip' }> }

export type AuditCategory = 'management' | 'auth' | 'status' | 'denied'
export type AuditItem = {
  id: number
  ts: string
  actorKind: 'user' | 'admin' | 'system'
  actorIsSelf: boolean
  clientId: string | null
  clientName: string | null
  action: string
  category: AuditCategory
  scope: 'user' | 'instance'
  targetType: string
  targetId: string | null
  targetLabel: string | null
  result: 'success' | 'denied' | 'pending' | 'status_change'
}
export type AuditList = { items: AuditItem[], nextCursor: string | null }

export type DashboardClient = { kind: 'oauth' | 'pat', id: string, name: string, allowlisted: boolean | null, active: boolean, lastActiveAt: string | null, callsPerMin: number, contextTokensEstimate: number | null }
export type DashboardAttention = { upstreamId: string, slug: string, name: string, status: UpstreamStatus, setup: UpstreamSetup, statusReason: string | null, nextRetryAt: string | null }
export type Dashboard = {
  clients: DashboardClient[], attention: DashboardAttention[], attentionCount: number
  kpis?: { clientsActive: number, clientsTotal: number, callsPerMin: number, successRate: number, overheadP95Ms: number } // Phase 2
  series?: Array<{ t: string, calls: number }> // Phase 2
}

// ---------------------------------------------------------------------------
// Frontend additions (the backend does not deliver these or only in later phases)
// ---------------------------------------------------------------------------

/** Response of `GET /api/auth/get-session` (Better Auth). */
export type AuthSession = { user: AuthSessionUser, session: { id: string, expiresAt: string } } | null

/**
 * Known error codes from `ApiErrorBody.data.code` (frontend helper type; the backend returns `string`).
 * Better Auth endpoints use uppercase codes (see `REGISTRATION_CLOSED`, `INVITE_REQUIRED`).
 */
export type ApiErrorCode =
  | 'validation' | 'not_found' | 'forbidden' | 'slug_taken' | 'limit_reached' | 'slug_immutable'
  | 'awaiting_auth' | 'stdio_not_allowed' | 'invite_required' | 'invite_invalid' | 'self_target'
  | 'last_admin' | 'invite_not_open' | 'invalid_consent_query' | 'client_not_found' | 'invalid_name'
  | 'pat_limit_reached' | 'invalid_mode' | 'invalid_entry' | 'oauth_discovery_failed'
  | typeof REGISTRATION_CLOSED | typeof INVITE_REQUIRED | typeof INVITE_INVALID | (string & {})

export const API_PATHS = {
  session: '/api/auth/get-session',
  signIn: '/api/auth/sign-in/email',
  signUp: '/api/auth/sign-up/email',
  signOut: '/api/auth/sign-out',
  upstreams: '/api/upstreams',
  capabilities: '/api/me/capabilities',
  meSettings: '/api/me/settings',
  publicConfig: '/api/public-config',
  requestPasswordReset: '/api/auth/request-password-reset',
  resetPassword: '/api/auth/reset-password',
  pats: '/api/me/pats',
  connections: '/api/me/connections',
  audit: '/api/audit',
  dashboard: '/api/dashboard',
} as const

export type CallOutcome = 'ok' | 'tool_error' | 'timeout' | 'upstream_error' | 'rate_limited' | 'breaker_open' | 'denied'
export type ToolMode = 'direct' | 'meta' // Phase 3

/**
 * `GET /api/public-config`, without a session.
 * `mail`: SMTP_URL is set (password reset by mail available).
 * `registrationOpen`: true only as long as no user exists yet (the first user registers without an invitation).
 */
export type PublicConfig = { mail: boolean, registrationOpen: boolean }

/** Personal settings (`GET`/`PATCH /api/me/settings`). `notifyStatusMail` applies only with an active mailer. */
export type MeSettings = { notifyStatusMail: boolean }

// Statistics (phase 2, proposal)
export type StatsWindow = '5m' | '1h' | '24h' | '7d'
export type StatsRow = { upstream: string, calls: number, okRate: number, p5Ms: number, p50Ms: number, p75Ms: number, p95Ms: number, p99Ms: number, overheadP95Ms: number }
export type StatsSummary = {
  window: StatsWindow, calls: number, callsPerMin: number, okRate: number, peakConcurrent: number, activeClients: number
  perHour: Array<{ t: string, calls: number }>
  outcomes: Array<{ outcome: CallOutcome, count: number }>
  rows: StatsRow[]
}

// Auth links and approval (phase 2, proposal)
export type LinkInfo =
  | { state: 'open', kind: 'token' | 'header' | 'oauth', upstream: { slug: string, url: string }, headerName?: string, expiresAt: string }
  | { state: 'expired' | 'used' | 'forbidden' }
export type LinkTestResult = { ok: boolean, toolCount?: number, message?: string }
export type StdioDraft = {
  id: string, slug: string, command: string, args: string[], cwd: string, envNames: string[]
  createdVia: { client: string, at: string }
}
