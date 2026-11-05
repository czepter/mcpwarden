/**
 * Geteilter Vertrag zwischen Frontend (app/**) und Backend (server/**).
 * Import überall als `#shared/api-types`.
 *
 * Regeln:
 * 1. Nur Typen und Konstanten; keine Laufzeitlogik, kein Import von Vue oder Nitro.
 * 2. Zeitstempel als ISO-8601-String, Zeitdauern in Millisekunden mit Suffix `Ms`,
 *    Anteile als Zahl 0 bis 1. Secrets kommen in keinem Antworttyp vor (nur `hasSecret: boolean`).
 * 3. Feld hinzufügen ist abwärtskompatibel und braucht nur den Hinweis im Commit-Betreff.
 *    Umbenennen oder Entfernen verlangt vorherige Absprache zwischen Frontend und dem
 *    Backend-Agenten der betroffenen Route und ändert Typ, Mock (Frontend) und Route im selben Commit.
 * 4. Wer eine Route baut oder ändert, ergänzt den Typ im selben Commit und prüft die Antwort
 *    mit `satisfies` gegen den Typ. Änderungen an der Datei tragen den Betreff-Präfix `contract:`.
 * 5. Das Backend baut keine Antwort, die vom Typ abweicht; weicht es bewusst ab, wird der Typ
 *    geändert (Regel 3), nicht die Abweichung verschwiegen.
 */

export type Role = 'admin' | 'user'

/** Nutzer in der Antwort von `GET /api/auth/get-session` (Teilmenge der Better-Auth-Felder). */
export interface AuthSessionUser {
  id: string
  name: string
  email: string
  role: Role
  banned: boolean
}

/** Fehlerform von Nitro (`createError`); `/api/auth/*` liefert stattdessen `AuthErrorBody`. */
export interface ApiErrorBody {
  statusCode: number
  statusMessage: string
  data?: { code?: string, field?: string, message?: string }
}

/** Fehlerform der Better-Auth-Endpunkte unter `/api/auth/*`. */
export interface AuthErrorBody {
  code?: string
  message: string
}

/** Stabiler Fehlercode (HTTP 403) von `POST /api/auth/sign-up/email`, wenn die Registrierung gesperrt ist. */
export const REGISTRATION_CLOSED = 'REGISTRATION_CLOSED'

// --- Phase 0b: OAuth-Provider, Consent, PATs, Clients (docs/plans/phase-0b.md, Abschnitt 4.1) ---

export type DcrMode = 'off' | 'allowlist' | 'open'
export type DcrPolicy = { mode: DcrMode } // Standard 'open'

// Consent: Name, Redirect-URIs, Allowlist-Status, Scopes (ohne Titel, Titel stehen im Frontend)
// `host` ist bei kind 'app' mit Scheme (z. B. `evil-app://claude.ai`), sonst der reine Host.
export type ConsentRedirectKind = 'web' | 'loopback' | 'app'
export type ConsentRedirect = { uri: string, host: string, kind: ConsentRedirectKind, loopback: boolean }
export type ConsentScope = { name: string, required: boolean }
export type ConsentInfo = {
  client: {
    id: string
    name: string // untrusted, auf 80 Zeichen gekürzt, nur als Text rendern
    redirects: ConsentRedirect[]
    allowlisted: boolean // live gegen die aktuelle Allowlist berechnet
    registeredAt: string
    viaDcr: boolean
  }
  scopes: ConsentScope[] // 'mcpwarden:admin' nur, wenn aktiviert (in 0b nie)
  resource: string // BASE_URL + '/mcp'
  loopback: boolean // mindestens eine Redirect-URI ist Loopback (Zusatzwarnung)
}

// PATs: Klartext nur in PatCreated.token
export type PatSummary = {
  id: string
  name: string
  prefix: string // 'mcpw_pat_' + 4 Zeichen
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}
export type PatList = { items: PatSummary[], limit: { max: number, active: number } } // max = 20
export type PatCreated = PatSummary & { token: string }
export type PatCreateInput = { name: string } // 1 bis 64 Zeichen

// Clients des Nutzers (UI-Wort "Clients", Pfad bleibt "connections")
export type ConnectionSummary = {
  clientId: string
  name: string
  scopes: string[]
  redirectHost: string
  allowlisted: boolean
  grantedAt: string
  lastUsedAt: string | null // letzter Aufruf auf /mcp, gedrosselt auf 1 min genau
  active: boolean // lastUsedAt höchstens 5 min her; Anzeige "Aktiv"/"Inaktiv" im Frontend
}
export type ConnectionList = { items: ConnectionSummary[] }

// Admin: Allowlist und Registrierungen
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
  userCount: number // Anzahl Consents
  allowlisted: boolean // live berechnet
  registeredVia: 'dcr' | 'admin'
  disabled: boolean
  expiresAt: string | null // createdAt + 30 Tage, solange nie genutzt; sonst null
}
export type OAuthClientAdminList = { items: OAuthClientAdmin[] }

// --- Phase 1: Upstreams, Admin, Audit, Dashboard (docs/plans/phase-1.md, Abschnitt 4.5) ---

export type UpstreamStatus = 'unknown' | 'healthy' | 'degraded' | 'open' | 'auth_expired' | 'disabled'
export type UpstreamSetup = 'ready' | 'awaiting_auth' | 'awaiting_approval'
export type UpstreamType = 'http' | 'stdio'
export type UpstreamAuthType = 'none' | 'bearer' | 'header' | 'env' // 'env': nur stdio
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
  recent?: Array<'ok' | 'warn' | 'err' | 'none'> // Phase 2, 24 Eintraege
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
  features?: { toolMode?: boolean, callLog?: boolean, healthHistory?: boolean } // spaetere Phasen
}

export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked'
export type InviteSummary = { id: string, email: string | null, createdAt: string, expiresAt: string, status: InviteStatus, usedAt: string | null, usedByUserId: string | null, createdByUserId: string | null }
export type InviteList = { items: InviteSummary[] }
export type InviteCreated = { id: string, email: string | null, createdAt: string, expiresAt: string, link: string }
export type InviteInfo = { valid: true, email: string | null, expiresAt: string } | { valid: false, reason: 'expired' | 'used' | 'revoked' | 'unknown' }
/** Stabile Codes (HTTP 403) von `POST /api/auth/sign-up/email`. */
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
export type DashboardAttention = { upstreamId: string, slug: string, name: string, status: UpstreamStatus, statusReason: string | null, nextRetryAt: string | null }
export type Dashboard = {
  clients: DashboardClient[], attention: DashboardAttention[], attentionCount: number
  kpis?: { clientsActive: number, clientsTotal: number, callsPerMin: number, successRate: number, overheadP95Ms: number } // Phase 2
  series?: Array<{ t: string, calls: number }> // Phase 2
}

// ---------------------------------------------------------------------------
// Frontend-Ergänzungen (Backend liefert diese nicht oder erst in späteren Phasen)
// ---------------------------------------------------------------------------

/** Antwort von `GET /api/auth/get-session` (Better Auth). */
export type AuthSession = { user: AuthSessionUser, session: { id: string, expiresAt: string } } | null

/**
 * Bekannte Fehlercodes aus `ApiErrorBody.data.code` (Frontend-Hilfstyp; das Backend liefert `string`).
 * Better-Auth-Endpunkte nutzen Großbuchstaben-Codes (siehe `REGISTRATION_CLOSED`, `INVITE_REQUIRED`).
 */
export type ApiErrorCode =
  | 'validation' | 'not_found' | 'forbidden' | 'slug_taken' | 'limit_reached' | 'slug_immutable'
  | 'awaiting_auth' | 'stdio_not_allowed' | 'invite_required' | 'invite_invalid' | 'self_target'
  | 'last_admin' | 'invite_not_open' | 'invalid_consent_query' | 'client_not_found' | 'invalid_name'
  | 'pat_limit_reached' | 'invalid_mode' | 'invalid_entry'
  | typeof REGISTRATION_CLOSED | typeof INVITE_REQUIRED | typeof INVITE_INVALID | (string & {})

export const API_PATHS = {
  session: '/api/auth/get-session',
  signIn: '/api/auth/sign-in/email',
  signUp: '/api/auth/sign-up/email',
  signOut: '/api/auth/sign-out',
  upstreams: '/api/upstreams',
  capabilities: '/api/me/capabilities',
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
 * `GET /api/public-config`, ohne Sitzung.
 * `mail`: SMTP_URL ist gesetzt (Passwort-Reset per Mail verfuegbar).
 * `registrationOpen`: true nur solange noch kein Nutzer existiert (der erste Nutzer registriert sich ohne Einladung).
 */
export type PublicConfig = { mail: boolean, registrationOpen: boolean }

// Statistik (Phase 2, Vorschlag)
export type StatsWindow = '5m' | '1h' | '24h' | '7d'
export type StatsRow = { upstream: string, calls: number, okRate: number, p5Ms: number, p50Ms: number, p75Ms: number, p95Ms: number, p99Ms: number, overheadP95Ms: number }
export type StatsSummary = {
  window: StatsWindow, calls: number, callsPerMin: number, okRate: number, peakConcurrent: number, activeClients: number
  perHour: Array<{ t: string, calls: number }>
  outcomes: Array<{ outcome: CallOutcome, count: number }>
  rows: StatsRow[]
}

// Auth-Links und Freigabe (Phase 2, Vorschlag)
export type LinkInfo =
  | { state: 'open', kind: 'token' | 'header' | 'oauth', upstream: { slug: string, url: string }, headerName?: string, expiresAt: string }
  | { state: 'expired' | 'used' | 'forbidden' }
export type LinkTestResult = { ok: boolean, toolCount?: number, message?: string }
export type StdioDraft = {
  id: string, slug: string, command: string, args: string[], cwd: string, envNames: string[]
  createdVia: { client: string, at: string }
}
