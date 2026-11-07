// Shared contract schemas (strict: missing AND unknown fields stand out).
// `satisfies z.ZodType<T>` binds each schema to the contract type in shared/api-types.ts.
// The same schemas check (1) the MSW mocks (tests/ui/contract) and (2) the REAL backend responses
// of the built server (tests/integration/contract.test.ts). If one side drifts, the test fails.
import { z } from 'zod'
import type {
  AdminSettingsResult, AdminUserList, AllowlistList, AuditList, AuthSession, Capabilities, ConnectionList, ConsentInfo, Dashboard, DcrPolicy,
  InviteCreated, InviteInfo, InviteList, MeSettings, OAuthClientAdminList, PatCreated, PatList, PublicConfig, UpstreamDetail, UpstreamList, UpstreamTestResult, UpstreamToolList,
} from '#shared/api-types'

const { string: str, number: num, boolean: bool } = z
const nstr = z.string().nullable()
const health = z.enum(['healthy', 'degraded', 'open', 'auth_expired', 'disabled', 'unknown'])
const setup = z.enum(['ready', 'awaiting_auth', 'awaiting_approval'])
const timeouts = z.strictObject({ connectMs: num(), listMs: num(), callMs: num() })
const limits = z.strictObject({ maxUpstreams: num(), callsPerMin: num(), maxConnections: num(), stdioMaxProcs: num(), stdioIdleMin: num() })
const summaryShape = {
  id: str(), slug: str(), name: str(), description: nstr, type: z.enum(['http', 'stdio']), url: nstr, command: nstr, enabled: bool(),
  status: health, statusReason: nstr, statusChangedAt: nstr, lastError: nstr, lastOkAt: nstr, setup, toolsEnabled: num(), toolsTotal: num(),
  nextRetryAt: nstr, rateLimitHits5m: num(), hasSecret: bool(),
  p95Ms: num().nullable().optional(), recent: z.array(z.enum(['ok', 'warn', 'err', 'none'])).optional(),
}
const annotations = z.strictObject({ readOnlyHint: bool().optional(), destructiveHint: bool().optional(), idempotentHint: bool().optional() })
const patSummary = { id: str(), name: str(), prefix: str(), createdAt: str(), lastUsedAt: nstr, revokedAt: nstr }

export const schemas = {
  session: z.union([z.null(), z.strictObject({ user: z.strictObject({ id: str(), name: str(), email: str(), role: z.enum(['admin', 'user']), banned: bool() }), session: z.strictObject({ id: str(), expiresAt: str() }) })]) satisfies z.ZodType<AuthSession>,
  upstreamList: z.strictObject({ items: z.array(z.strictObject(summaryShape)) }) satisfies z.ZodType<UpstreamList>,
  upstreamDetail: z.strictObject({
    ...summaryShape, transport: z.enum(['auto', 'streamable', 'sse']), authType: z.enum(['none', 'bearer', 'header', 'env', 'oauth']), authHeaderName: nstr,
    ratePerMin: num(), maxConcurrent: num(), timeouts, args: z.array(str()), cwd: nstr, env: z.record(str(), str()), secretNames: z.array(str()),
    version: num(), createdAt: str(), updatedAt: str(),
  }) satisfies z.ZodType<UpstreamDetail>,
  tools: z.strictObject({
    items: z.array(z.strictObject({ name: str(), title: nstr, description: nstr, enabled: bool(), gone: bool(), firstSeenAt: str(), lastSeenAt: str(), annotations: annotations.optional() })),
    fetchedAt: nstr, stale: bool(),
  }) satisfies z.ZodType<UpstreamToolList>,
  testResult: z.union([
    z.strictObject({ ok: z.literal(true), tools: z.array(z.strictObject({ name: str(), description: str().optional() })), latencyMs: num() }),
    z.strictObject({
      ok: z.literal(false),
      errorCode: z.enum(['ssrf_blocked', 'redirect', 'timeout', 'connect_failed', 'unauthorized', 'upstream_error', 'protocol', 'awaiting_auth', 'stdio_not_allowed']),
      message: str(), latencyMs: num().optional(),
    }),
  ]) satisfies z.ZodType<UpstreamTestResult>,
  pats: z.strictObject({ items: z.array(z.strictObject(patSummary)), limit: z.strictObject({ max: num(), active: num() }) }) satisfies z.ZodType<PatList>,
  patCreated: z.strictObject({ ...patSummary, token: str() }) satisfies z.ZodType<PatCreated>,
  connections: z.strictObject({ items: z.array(z.strictObject({ clientId: str(), name: str(), scopes: z.array(str()), redirectHost: str(), allowlisted: bool(), grantedAt: str(), lastUsedAt: nstr, active: bool() })) }) satisfies z.ZodType<ConnectionList>,
  capabilities: z.strictObject({
    mcpUrl: str(), role: z.enum(['admin', 'user']),
    stdio: z.strictObject({ allowed: bool(), reason: z.enum(['instance_disabled', 'not_granted', 'no_capabilities', 'supervisor_unreachable', 'image_slim']).optional() }),
    limits: z.strictObject({ maxUpstreams: num(), upstreamsUsed: num(), maxConnections: num(), callsPerMin: num() }),
    defaults: z.strictObject({ ratePerMin: num(), maxConcurrent: num(), timeouts }),
    features: z.strictObject({ toolMode: bool().optional(), callLog: bool().optional(), healthHistory: bool().optional() }).optional(),
  }) satisfies z.ZodType<Capabilities>,
  users: z.strictObject({
    items: z.array(z.strictObject({ id: str(), email: str(), name: str(), role: z.enum(['admin', 'user']), banned: bool(), banReason: nstr, createdAt: str(), upstreamCount: num(), lastActivityAt: nstr, stdioAllowed: bool(), limits })),
    defaults: limits,
  }) satisfies z.ZodType<AdminUserList>,
  invites: z.strictObject({
    items: z.array(z.strictObject({ id: str(), email: nstr, createdAt: str(), expiresAt: str(), status: z.enum(['open', 'used', 'expired', 'revoked']), usedAt: nstr, usedByUserId: nstr, createdByUserId: nstr })),
  }) satisfies z.ZodType<InviteList>,
  inviteCreated: z.strictObject({ id: str(), email: nstr, createdAt: str(), expiresAt: str(), link: str(), mailQueued: bool().optional() }) satisfies z.ZodType<InviteCreated>,
  inviteCheck: z.union([
    z.strictObject({ valid: z.literal(true), email: nstr, expiresAt: str() }),
    z.strictObject({ valid: z.literal(false), reason: z.enum(['expired', 'used', 'revoked', 'unknown']) }),
  ]) satisfies z.ZodType<InviteInfo>,
  /** GET and PUT /api/admin/settings return the same shape (incl. warnings). */
  settings: z.strictObject({
    'stdio.enabled': bool(), 'ssrf.allow': z.array(str()),
    warnings: z.array(z.strictObject({ key: str(), entry: str(), code: z.literal('covers_metadata_ip') })),
  }) satisfies z.ZodType<AdminSettingsResult>,
  policy: z.strictObject({ mode: z.enum(['off', 'allowlist', 'open']) }) satisfies z.ZodType<DcrPolicy>,
  allowlist: z.strictObject({ items: z.array(z.strictObject({ id: str(), label: str(), namePattern: str(), redirectPatterns: z.array(str()), builtin: bool(), createdAt: str() })) }) satisfies z.ZodType<AllowlistList>,
  oauthClients: z.strictObject({
    items: z.array(z.strictObject({ id: str(), name: str(), redirectUris: z.array(str()), createdAt: str(), lastUsedAt: nstr, userCount: num(), allowlisted: bool(), registeredVia: z.enum(['dcr', 'admin']), disabled: bool(), expiresAt: nstr })),
  }) satisfies z.ZodType<OAuthClientAdminList>,
  consent: z.strictObject({
    client: z.strictObject({ id: str(), name: str(), redirects: z.array(z.strictObject({ uri: str(), host: str(), kind: z.enum(['web', 'loopback', 'app']), loopback: bool() })), allowlisted: bool(), registeredAt: str(), viaDcr: bool() }),
    scopes: z.array(z.strictObject({ name: str(), required: bool() })), resource: str(), loopback: bool(),
  }) satisfies z.ZodType<ConsentInfo>,
  dashboard: z.strictObject({
    clients: z.array(z.strictObject({ kind: z.enum(['oauth', 'pat']), id: str(), name: str(), allowlisted: z.boolean().nullable(), active: bool(), lastActiveAt: nstr, callsPerMin: num(), contextTokensEstimate: num().nullable() })),
    attention: z.array(z.strictObject({ upstreamId: str(), slug: str(), name: str(), status: health, setup: z.enum(['ready', 'awaiting_auth', 'awaiting_approval']), statusReason: nstr, nextRetryAt: nstr })),
    attentionCount: num(),
  }) satisfies z.ZodType<Dashboard>,
  audit: z.strictObject({
    items: z.array(z.strictObject({
      id: num(), ts: str(), actorKind: z.enum(['user', 'admin', 'system']), actorIsSelf: bool(), clientId: nstr, clientName: nstr, action: str(), category: z.enum(['management', 'auth', 'status', 'denied']),
      scope: z.enum(['user', 'instance']), targetType: str(), targetId: nstr, targetLabel: nstr, result: z.enum(['success', 'pending', 'denied', 'status_change']),
    })),
    nextCursor: nstr,
  }) satisfies z.ZodType<AuditList>,
  meSettings: z.strictObject({ notifyStatusMail: bool() }) satisfies z.ZodType<MeSettings>,
  publicConfig: z.strictObject({ mail: bool(), registrationOpen: bool() }) satisfies z.ZodType<PublicConfig>,
  /** Nitro error shape (`ApiErrorBody`), not `/api/auth/*`. */
  apiError: z.looseObject({ statusCode: num(), statusMessage: str(), data: z.looseObject({ code: str().optional(), field: str().optional(), message: str().optional() }).optional() }),
}
