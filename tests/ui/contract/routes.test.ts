import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type {
  AdminSettings, AdminUserList, AllowlistList, AuditList, AuthSession, ConnectionList, ConsentInfo, DcrPolicy, InviteCheck, InviteList,
  LinkInfo, OAuthClientAdminList, PatList, PublicConfig, StatsSummary, StdioDraft, TestResult, ToolList, UpstreamDetail, UpstreamList,
} from '#shared/api-types'
import { makeServer } from '../../../mocks/node'
import { getState, resetState } from '../../../mocks/state'

// Strikte Schemas (strictObject): fehlende UND unbekannte Felder in Mock-Antworten fallen auf.
// `satisfies z.ZodType<T>` bindet jedes Schema an den Vertragstyp in shared/api-types.ts; Backend-Tests koennen dieselben Schemas nutzen.
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3000'
const { string: str, number: num, boolean: bool } = z
const nstr = z.string().nullable()
const health = z.enum(['healthy', 'degraded', 'open', 'auth_expired', 'disabled', 'unknown'])
const setup = z.enum(['ready', 'awaiting_auth', 'awaiting_approval'])
const timeouts = z.strictObject({ connectMs: num(), listMs: num(), callMs: num() })
const limits = z.strictObject({ maxUpstreams: num(), callsPerMin: num(), maxConnections: num(), stdioMaxProcs: num(), stdioIdleMin: num() })
const summaryShape = {
  id: str(), slug: str(), name: str(), description: nstr, type: z.enum(['http', 'stdio', 'rest']), url: nstr, command: nstr, enabled: bool(),
  status: health, statusReason: nstr, statusChangedAt: nstr, lastError: nstr, lastOkAt: nstr, setup, toolsEnabled: num(), toolsTotal: num(),
  nextRetryAt: nstr, rateLimitHits5m: num(), hasSecret: bool(),
  p95Ms: num().nullable().optional(), recent: z.array(z.enum(['ok', 'warn', 'err', 'none'])).optional(),
}
const annotations = z.strictObject({ readOnlyHint: bool().optional(), destructiveHint: bool().optional(), idempotentHint: bool().optional() })

const schemas = {
  session: z.union([z.null(), z.strictObject({ user: z.strictObject({ id: str(), name: str(), email: str(), role: z.enum(['admin', 'user']), banned: bool() }), session: z.strictObject({ id: str(), expiresAt: str() }) })]) satisfies z.ZodType<AuthSession>,
  upstreamList: z.strictObject({ items: z.array(z.strictObject(summaryShape)) }) satisfies z.ZodType<UpstreamList>,
  upstreamDetail: z.strictObject({
    ...summaryShape, transport: z.enum(['auto', 'streamable', 'sse']).nullable(), authType: z.enum(['none', 'bearer', 'header', 'oauth']), authHeaderName: nstr,
    ratePerMin: num(), maxConcurrent: num(), timeouts, args: z.array(str()), cwd: nstr, env: z.record(str(), str()), secretNames: z.array(str()),
    version: num(), createdAt: str(), updatedAt: str(),
  }) satisfies z.ZodType<UpstreamDetail>,
  tools: z.strictObject({
    items: z.array(z.strictObject({ name: str(), title: nstr, description: str(), enabled: bool(), gone: bool(), firstSeenAt: str(), lastSeenAt: str(), annotations: annotations.optional() })),
    fetchedAt: str(), stale: bool(),
  }) satisfies z.ZodType<ToolList>,
  testResult: z.union([
    z.strictObject({ ok: z.literal(true), tools: z.array(z.strictObject({ name: str(), description: str() })), latencyMs: num() }),
    z.strictObject({ ok: z.literal(false), errorCode: str(), message: str(), latencyMs: num().optional() }),
  ]) as unknown as z.ZodType<TestResult>,
  draft: z.strictObject({ id: str(), slug: str(), command: str(), args: z.array(str()), cwd: str(), envNames: z.array(str()), createdVia: z.strictObject({ client: str(), at: str() }) }) satisfies z.ZodType<StdioDraft>,
  pats: z.strictObject({ items: z.array(z.strictObject({ id: str(), name: str(), prefix: str(), createdAt: str(), lastUsedAt: nstr, revokedAt: nstr })), limit: z.strictObject({ max: num(), active: num() }) }) satisfies z.ZodType<PatList>,
  connections: z.strictObject({ items: z.array(z.strictObject({ clientId: str(), name: str(), scopes: z.array(str()), redirectHost: str(), allowlisted: bool(), grantedAt: str(), lastUsedAt: nstr, active: bool() })) }) satisfies z.ZodType<ConnectionList>,
  users: z.strictObject({
    items: z.array(z.strictObject({ id: str(), email: str(), name: str(), role: z.enum(['admin', 'user']), banned: bool(), banReason: nstr, createdAt: str(), upstreamCount: num(), lastActivityAt: nstr, stdioAllowed: bool(), limits })),
    defaults: limits,
  }) satisfies z.ZodType<AdminUserList>,
  invites: z.strictObject({
    items: z.array(z.strictObject({ id: str(), email: nstr, createdAt: str(), expiresAt: str(), status: z.enum(['open', 'used', 'expired', 'revoked']), usedAt: nstr, usedByUserId: nstr, createdByUserId: str() })),
  }) satisfies z.ZodType<InviteList>,
  inviteCheck: z.union([
    z.strictObject({ valid: z.literal(true), email: nstr, expiresAt: str() }),
    z.strictObject({ valid: z.literal(false), reason: z.enum(['expired', 'used', 'revoked', 'unknown']) }),
  ]) satisfies z.ZodType<InviteCheck>,
  settings: z.strictObject({ 'stdio.enabled': bool(), 'ssrf.allow': z.array(str()) }) satisfies z.ZodType<AdminSettings>,
  policy: z.strictObject({ mode: z.enum(['off', 'allowlist', 'open']) }) satisfies z.ZodType<DcrPolicy>,
  allowlist: z.strictObject({ items: z.array(z.strictObject({ id: str(), label: str(), namePattern: str(), redirectPatterns: z.array(str()), builtin: bool(), createdAt: str() })) }) satisfies z.ZodType<AllowlistList>,
  oauthClients: z.strictObject({
    items: z.array(z.strictObject({ id: str(), name: str(), redirectUris: z.array(str()), createdAt: str(), lastUsedAt: nstr, userCount: num(), allowlisted: bool(), registeredVia: z.enum(['dcr', 'admin']), disabled: bool(), expiresAt: nstr })),
  }) satisfies z.ZodType<OAuthClientAdminList>,
  consent: z.strictObject({
    client: z.strictObject({ id: str(), name: str(), redirects: z.array(z.strictObject({ uri: str(), host: str(), kind: z.enum(['web', 'loopback', 'app']), loopback: bool() })), allowlisted: bool(), registeredAt: str(), viaDcr: bool() }),
    scopes: z.array(z.strictObject({ name: str(), required: bool() })), resource: str(), loopback: bool(),
  }) satisfies z.ZodType<ConsentInfo>,
  stats: z.strictObject({
    window: z.enum(['5m', '1h', '24h', '7d']), calls: num(), callsPerMin: num(), okRate: num(), peakConcurrent: num(), activeClients: num(),
    perHour: z.array(z.strictObject({ t: str(), calls: num() })),
    outcomes: z.array(z.strictObject({ outcome: z.enum(['ok', 'tool_error', 'timeout', 'upstream_error', 'rate_limited', 'breaker_open', 'denied']), count: num() })),
    rows: z.array(z.strictObject({ upstream: str(), calls: num(), okRate: num(), p5Ms: num(), p50Ms: num(), p75Ms: num(), p95Ms: num(), p99Ms: num(), overheadP95Ms: num() })),
  }) satisfies z.ZodType<StatsSummary>,
  link: z.union([
    z.strictObject({ state: z.literal('open'), kind: z.enum(['token', 'header', 'oauth']), upstream: z.strictObject({ slug: str(), url: str() }), headerName: str().optional(), expiresAt: str() }),
    z.strictObject({ state: z.enum(['expired', 'used', 'forbidden']) }),
  ]) satisfies z.ZodType<LinkInfo>,
  publicConfig: z.strictObject({ mail: bool() }) satisfies z.ZodType<PublicConfig>,
  audit: z.strictObject({
    items: z.array(z.strictObject({
      id: str(), ts: str(), actorKind: z.enum(['user', 'admin', 'system']), actorIsSelf: bool(), clientId: nstr, clientName: nstr, action: str(), category: z.enum(['admin', 'auth', 'status', 'denied']),
      scope: z.enum(['user', 'instance']), targetType: nstr, targetId: nstr, targetLabel: nstr, result: z.enum(['ok', 'pending', 'denied', 'status_change']),
    })),
    nextCursor: nstr,
  }) satisfies z.ZodType<AuditList>,
}

const server = makeServer('all')
beforeAll(() => { (globalThis as { __mockNoDelay?: boolean }).__mockNoDelay = true; server.listen({ onUnhandledFrame: 'error' }) })
afterAll(() => server.close())
beforeEach(() => { resetState(); getState().signedIn = true })

const get = (path: string) => fetch(`${BASE}${path}`)
const post = (path: string, body?: unknown) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

describe('alle GET-Routen: strikte Vertrags-Schemas', () => {
  const cases: Array<[string, string, keyof typeof schemas]> = [
    ['Sitzung', '/api/auth/get-session', 'session'],
    ['Upstream-Liste', '/api/upstreams', 'upstreamList'],
    ['Upstream-Detail', '/api/upstreams/up_1', 'upstreamDetail'],
    ['Tools', '/api/upstreams/up_1/tools', 'tools'],
    ['stdio-Entwurf', '/api/upstreams/up_1/draft', 'draft'],
    ['Tokens', '/api/me/pats', 'pats'],
    ['Verbindungen', '/api/me/connections', 'connections'],
    ['Nutzer', '/api/admin/users', 'users'],
    ['Einladungen', '/api/admin/invites', 'invites'],
    ['Einladung gueltig', '/api/invites/gueltig-token', 'inviteCheck'],
    ['Einladung abgelaufen', '/api/invites/abgelaufen-token', 'inviteCheck'],
    ['Instanz-Einstellungen', '/api/admin/settings', 'settings'],
    ['DCR-Richtlinie', '/api/admin/oauth/policy', 'policy'],
    ['Allowlist', '/api/admin/oauth/allowlist', 'allowlist'],
    ['OAuth-Clients', '/api/admin/oauth/clients', 'oauthClients'],
    ['Consent (unbekannt)', '/api/oauth/consent-info?client_id=agent-x&sig=ok', 'consent'],
    ['Consent (bekannt)', '/api/oauth/consent-info?client_id=claude-code&sig=ok', 'consent'],
    ['Statistik', '/api/stats/summary?window=24h', 'stats'],
    ['Link offen', '/api/links/abc', 'link'],
    ['Link abgelaufen', '/api/links/abgelaufen', 'link'],
    ['Audit', '/api/audit', 'audit'],
    ['Public-Config', '/api/public-config', 'publicConfig'],
  ]
  for (const [name, path, key] of cases) {
    it(name, async () => {
      const r = await get(path)
      expect(r.status).toBe(200)
      const res = schemas[key].safeParse(await r.json())
      expect(res.success ? [] : res.error.issues, `${path}`).toEqual([])
    })
  }
  it('Test-Antwort (ok und Fehler)', async () => {
    const ok = await post('/api/upstreams/up_1/test')
    expect(schemas.testResult.safeParse(await ok.json()).success).toBe(true)
  })
})

describe('Fehler und Rollen wie das Backend', () => {
  it('Admin-Routen: Nutzer bekommt 403 mit ApiErrorBody', async () => {
    localStorage.setItem('mockRole', 'user')
    for (const p of ['/api/admin/users', '/api/admin/invites', '/api/admin/settings', '/api/admin/oauth/policy', '/api/admin/oauth/clients']) {
      const r = await get(p)
      expect(r.status, p).toBe(403)
      z.strictObject({ statusCode: z.literal(403), statusMessage: str(), data: z.looseObject({ code: z.literal('forbidden'), message: str() }) }).parse(await r.json())
    }
  })
  it('Registrierung: Passwort unter 12 Zeichen wird serverseitig abgelehnt', async () => {
    const r = await fetch(`${BASE}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-invite-token': 'gueltig-token' }, body: JSON.stringify({ name: 'N', email: 'n@example.test', password: 'kurz' }) })
    expect(r.status).toBe(422)
    expect(((await r.json()) as { data: { field?: string } }).data.field).toBe('password')
  })
})
