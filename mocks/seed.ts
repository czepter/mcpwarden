import type {
  AdminUser, AllowlistEntry, AuditItem, ConnectionSummary, InviteSummary, OAuthClientAdmin, PatSummary, UpstreamDetail, UpstreamToolItem, UserLimits,
} from '#shared/api-types'

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString()

export const DEFAULT_LIMITS: UserLimits = { maxUpstreams: 50, callsPerMin: 120, maxConnections: 20, stdioMaxProcs: 5, stdioIdleMin: 10 }

const bars = (s: string) => s.split('').map(c => ({ g: 'ok', y: 'warn', r: 'err', n: 'none' } as const)[c as 'g'])
const SRC: Array<[string, string, string, 'http' | 'stdio', UpstreamDetail['status'], number, number, string | null, string, number | null]> = [
  ['github', 'GitHub', 'api.githubcopilot.com/mcp', 'http', 'healthy', 38, 42, null, 'gggggggggggggggggggggggg', 212],
  ['sentry', 'Sentry', 'mcp.sentry.dev/mcp', 'http', 'auth_expired', 14, 14, 'Refresh-Token abgelehnt. Neuer Link nötig.', 'ggggggggggggggggggnnnrrr', null],
  ['filesystem', 'Filesystem', 'npx @modelcontextprotocol/server-filesystem', 'stdio', 'healthy', 11, 11, null, 'gggggggggggggggggggggggg', 38],
  ['linear', 'Linear', 'mcp.linear.app/mcp', 'http', 'degraded', 24, 31, 'Mehrere Fehler in Folge, Verbindung eingeschränkt.', 'ggggggggggggyggyyggyyyyy', 1240],
  ['postgres-prod', 'Postgres (prod)', 'uvx mcp-server-postgres', 'stdio', 'open', 6, 6, 'Breaker offen, nächster Versuch gleich.', 'ggggggggggggggggrrrrrrrr', null],
  ['local', 'Lokale Tools', 'tools.internal.example/mcp', 'http', 'healthy', 3, 3, null, 'ggggggggggggggggggggggng', 96],
  ['notion', 'Notion', 'mcp.notion.com/mcp', 'http', 'disabled', 0, 18, 'Vom Nutzer deaktiviert.', 'nnnnnnnnnnnnnnnnnnnnnnnn', null],
]

export function seedUpstreams(): UpstreamDetail[] {
  return SRC.map(([slug, name, sub, type, status, en, total, reason, b, p95], i) => ({
    id: `up_${i + 1}`, slug, name, description: null, type,
    url: type === 'http' ? `https://${sub}` : null, command: type === 'stdio' ? sub : null,
    enabled: status !== 'disabled', status, statusReason: reason, statusChangedAt: ago(30 + i), lastError: status === 'healthy' ? null : reason, lastOkAt: ago(5),
    setup: 'ready', toolsEnabled: en, toolsTotal: total, nextRetryAt: status === 'open' ? ahead(1) : null, rateLimitHits5m: status === 'degraded' ? 3 : 0,
    hasSecret: type === 'http' && slug !== 'local', p95Ms: p95, recent: bars(b),
    transport: 'auto', authType: slug === 'github' ? 'bearer' : slug === 'sentry' ? 'header' : 'none', authHeaderName: slug === 'sentry' ? 'X-Api-Key' : null,
    ratePerMin: 60, maxConcurrent: 5, timeouts: { connectMs: 10_000, listMs: 15_000, callMs: 60_000 },
    args: [], cwd: null, env: {}, secretNames: [], version: 1, createdAt: ago(60 * 24 * 10), updatedAt: ago(60),
  }))
}

const BASE = ['list_issues', 'get_issue', 'create_issue', 'update_issue', 'delete_issue', 'search_code', 'get_file', 'list_projects']
export function seedTools(u: UpstreamDetail): UpstreamToolItem[] {
  return Array.from({ length: u.toolsTotal }, (_, i) => {
    const base = BASE[i % BASE.length]!
    const name = i < BASE.length ? base : `${base}_${Math.floor(i / BASE.length) + 1}`
    const annotations = /^(list|get|search)/.test(base) ? { readOnlyHint: true } : /^delete/.test(base) ? { destructiveHint: true } : { readOnlyHint: false }
    return { name, title: null, description: `Beschreibung für ${name} (Text vom Upstream, nicht vertrauenswürdig).`, enabled: i < u.toolsEnabled, gone: false, firstSeenAt: ago(5000), lastSeenAt: ago(5), annotations }
  })
}

export const seedUsers = (): AdminUser[] => [
  { id: 'usr_1', email: 'admin@example.test', name: 'Christian', role: 'admin', banned: false, banReason: null, createdAt: ago(60 * 24 * 40), upstreamCount: 7, lastActivityAt: ago(1), stdioAllowed: true, limits: { ...DEFAULT_LIMITS } },
  { id: 'usr_2', email: 'mara@example.test', name: 'Mara', role: 'user', banned: false, banReason: null, createdAt: ago(60 * 24 * 20), upstreamCount: 12, lastActivityAt: ago(95), stdioAllowed: false, limits: { ...DEFAULT_LIMITS } },
  { id: 'usr_3', email: 'jonas@example.test', name: 'Jonas', role: 'user', banned: false, banReason: null, createdAt: ago(60 * 24 * 5), upstreamCount: 3, lastActivityAt: null, stdioAllowed: false, limits: { ...DEFAULT_LIMITS } },
]

export const seedInvites = (): InviteSummary[] => [
  { id: 'inv_1', email: null, createdAt: ago(60 * 24), expiresAt: ahead(60 * 24 * 6), status: 'open', usedAt: null, usedByUserId: null, createdByUserId: 'usr_1' },
  { id: 'inv_2', email: 'neu@example.test', createdAt: ago(60 * 24 * 2), expiresAt: ahead(60 * 24 * 5), status: 'open', usedAt: null, usedByUserId: null, createdByUserId: 'usr_1' },
]
/** Feste Test-Token der Einladungs-Seite (keine Geheimnisse). */
export const SEED_INVITE_TOKENS: Record<string, string> = {
  'gueltig-token': 'inv_1', 'gebunden-token': 'inv_2', 'abgelaufen-token': 'expired', 'verbraucht-token': 'used',
}

export const seedPats = (): PatSummary[] => [
  { id: 'pat_1', name: 'nas-cron', prefix: 'mcpw_pat_9f3c', createdAt: ago(60 * 24 * 30), lastUsedAt: ago(2), revokedAt: null },
  { id: 'pat_2', name: 'Laptop CLI', prefix: 'mcpw_pat_a1b2', createdAt: ago(60 * 24 * 12), lastUsedAt: ago(60 * 5), revokedAt: null },
  { id: 'pat_3', name: 'Alt', prefix: 'mcpw_pat_77de', createdAt: ago(60 * 24 * 90), lastUsedAt: null, revokedAt: ago(60 * 24 * 60) },
]

export const seedConnections = (): ConnectionSummary[] => [
  { clientId: 'claude-code', name: 'Claude Code', scopes: ['mcp:tools'], redirectHost: 'localhost', allowlisted: true, grantedAt: ago(60 * 24 * 14), lastUsedAt: ago(1), active: true },
  { clientId: 'cursor', name: 'Cursor', scopes: ['mcp:tools'], redirectHost: 'anysphere.cursor-retrieval', allowlisted: true, grantedAt: ago(60 * 24 * 9), lastUsedAt: ago(3), active: true },
  { clientId: 'claude-web', name: 'Claude', scopes: ['mcp:tools', 'mcpwarden:admin'], redirectHost: 'claude.ai', allowlisted: true, grantedAt: ago(60 * 24 * 7), lastUsedAt: ago(40), active: false },
  { clientId: 'zed', name: 'Zed', scopes: ['mcp:tools'], redirectHost: 'zed', allowlisted: true, grantedAt: ago(60 * 24 * 3), lastUsedAt: ago(70), active: false },
  { clientId: 'agent-x', name: 'agent.example.org', scopes: ['mcp:tools'], redirectHost: 'agent.example.org', allowlisted: false, grantedAt: ago(60 * 24), lastUsedAt: ago(2), active: true },
  { clientId: 'old', name: 'Alter Client', scopes: ['mcp:tools'], redirectHost: 'localhost', allowlisted: false, grantedAt: ago(60 * 24 * 40), lastUsedAt: null, active: false },
]

export const seedAllowlist = (): AllowlistEntry[] => [
  ['Claude Code', 'Claude Code*', ['http://localhost:*/callback', 'http://127.0.0.1:*/callback']],
  ['Claude (Web)', 'Claude', ['https://claude.ai/api/mcp/auth_callback']],
  ['Cursor', 'Cursor*', ['cursor://anysphere.cursor-retrieval/*']],
  ['VS Code', 'Visual Studio Code*', ['vscode://*', 'http://127.0.0.1:*/']],
  ['Zed', 'Zed*', ['zed://*']],
  ['Windsurf', 'Windsurf*', ['windsurf://*']],
  ['MCP Inspector', 'MCP Inspector*', ['http://localhost:6274/*']],
].map(([label, namePattern, redirectPatterns], i) => ({ id: `al_${i + 1}`, label: label as string, namePattern: namePattern as string, redirectPatterns: redirectPatterns as string[], builtin: true, createdAt: ago(60 * 24 * 40) }))

export const seedOAuthClients = (): OAuthClientAdmin[] => [
  { id: 'cl_1', name: 'Claude Code', redirectUris: ['http://localhost:33418/callback'], createdAt: ago(60 * 24 * 14), lastUsedAt: ago(1), userCount: 2, allowlisted: true, registeredVia: 'dcr', disabled: false, expiresAt: null },
  { id: 'cl_2', name: 'Cursor', redirectUris: ['cursor://anysphere.cursor-retrieval/oauth/callback'], createdAt: ago(60 * 24 * 9), lastUsedAt: ago(3), userCount: 1, allowlisted: true, registeredVia: 'dcr', disabled: false, expiresAt: null },
  { id: 'cl_3', name: 'agent.example.org', redirectUris: ['https://agent.example.org/cb'], createdAt: ago(60 * 24), lastUsedAt: ago(2), userCount: 1, allowlisted: false, registeredVia: 'dcr', disabled: false, expiresAt: null },
  { id: 'cl_4', name: 'Unbenutzt', redirectUris: ['http://localhost:9999/cb'], createdAt: ago(60 * 24 * 6), lastUsedAt: null, userCount: 0, allowlisted: false, registeredVia: 'dcr', disabled: false, expiresAt: ahead(60 * 24 * 24) },
]

export const seedAudit = (): AuditItem[] => {
  const mk = (i: number, min: number, action: string, cat: AuditItem['category'], result: AuditItem['result'], target: string | null, client: string | null, scope: 'user' | 'instance' = 'user'): AuditItem => ({
    id: 1000 - i, ts: ago(min), actorKind: scope === 'instance' ? 'admin' : 'user', actorIsSelf: true, clientId: null, clientName: client, action, category: cat, scope, targetType: target ? 'upstream' : 'settings', targetId: null, targetLabel: target, result,
  })
  return [
    mk(0, 3, 'upstream.created', 'management', 'success', 'sentry', 'Claude Code'),
    mk(1, 12, 'upstream.status_changed', 'status', 'status_change', 'postgres-prod', null),
    mk(2, 25, 'upstream.secret_replaced', 'management', 'success', 'github', null),
    mk(3, 60, 'upstream.stdio_requested', 'management', 'pending', 'duckdb', 'Claude Code'),
    mk(4, 120, 'tool.denied', 'denied', 'denied', 'github', 'Cursor'),
    mk(5, 200, 'user.banned', 'management', 'success', 'jonas', null, 'instance'),
    mk(6, 400, 'settings.changed', 'management', 'success', null, null, 'instance'),
    mk(7, 900, 'upstream.deleted', 'management', 'success', 'altes-tool', null),
  ]
}
