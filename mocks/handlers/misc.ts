import type { AuditItem, DashboardClient, CallOutcome, Dashboard, LinkInfo, StatsSummary, StatsWindow } from '#shared/api-types'
import { getState, role, scenario } from '../state'
import { err, json, route } from '../util'

export const auditHandlers = [
  route('get', '/api/audit', ({ request }) => {
    const q = new URL(request.url).searchParams
    const cat = q.get('category'); const cursor = Number(q.get('cursor') ?? 0); const limit = Number(q.get('limit') ?? 50)
    let all: AuditItem[] = scenario() === 'empty' ? [] : getState().audit
    if (scenario() === 'huge') all = Array.from({ length: 120 }, (_, i) => ({ ...getState().audit[i % 8]!, id: 5000 - i }))
    if (role() !== 'admin') all = all.filter(a => a.scope === 'user')
    if (cat) all = all.filter(a => a.category === cat)
    const items = all.slice(cursor, cursor + limit)
    return json({ items, nextCursor: cursor + limit < all.length ? String(cursor + limit) : null })
  }),
]

export const dashboardHandlers = [
  route('get', '/api/dashboard', () => {
    const s = getState()
    const empty = scenario() === 'empty'
    const nothing = scenario() === 'default' && s.upstreams.every(u => !['degraded', 'open', 'auth_expired'].includes(u.status) && u.setup === 'ready')
    const attention = empty ? [] : s.upstreams.filter(u => ['degraded', 'open', 'auth_expired'].includes(u.status) || u.setup !== 'ready')
      .map(u => ({
        upstreamId: u.id, slug: u.slug, name: u.name, status: u.status, setup: u.setup, nextRetryAt: u.nextRetryAt,
        statusReason: u.statusReason ?? (u.setup === 'awaiting_auth' ? 'Zugangsdaten fehlen noch' : u.setup === 'awaiting_approval' ? 'Wartet auf Freigabe' : null),
      }))
    const clients: DashboardClient[] = empty ? [] : s.connections.map((c, i) => ({
      kind: 'oauth' as const, id: c.clientId, name: c.name, allowlisted: c.allowlisted, active: c.active, lastActiveAt: c.lastUsedAt, callsPerMin: c.active ? 4 + i : 0, contextTokensEstimate: 1800 + i * 420,
    }))
    if (!empty) s.pats.filter(p => !p.revokedAt).slice(0, 1).forEach(p => clients.push({ kind: 'pat', id: p.id, name: p.name, allowlisted: null, active: true, lastActiveAt: p.lastUsedAt, callsPerMin: 2, contextTokensEstimate: 2100 }))
    void nothing
    return json<Dashboard>({ clients, attention, attentionCount: attention.length })
  }),
]

const OUT: CallOutcome[] = ['ok', 'tool_error', 'timeout', 'upstream_error', 'rate_limited', 'breaker_open', 'denied']
export const statsHandlers = [
  route('get', '/api/stats/summary', ({ request }) => {
    const w = (new URL(request.url).searchParams.get('window') ?? '24h') as StatsWindow
    const f = { '5m': 0.01, '1h': 0.1, '24h': 1, '7d': 6.5 }[w] ?? 1
    const calls = Math.round(9874 * f)
    const counts = [0.947, 0.02, 0.01, 0.012, 0.006, 0.004, 0.001]
    const body: StatsSummary = {
      window: w, calls, callsPerMin: Math.round((calls / ({ '5m': 5, '1h': 60, '24h': 1440, '7d': 10080 }[w])) * 10) / 10, okRate: 0.947, peakConcurrent: 4, activeClients: 4,
      perHour: Array.from({ length: 24 }, (_, i) => ({ t: new Date(Date.now() - (23 - i) * 3_600_000).toISOString(), calls: Math.round((300 + 250 * Math.sin(i / 3) + 80 * (i % 5)) * f) })),
      outcomes: OUT.map((outcome, i) => ({ outcome, count: Math.round(calls * counts[i]!) })),
      rows: getState().upstreams.filter(u => u.enabled).map((u, i) => ({ upstream: u.slug, calls: Math.round((2400 - i * 300) * f), okRate: 0.99 - i * 0.02, p5Ms: 20 + i, p50Ms: 60 + i * 12, p75Ms: 110 + i * 20, p95Ms: 212 + i * 100, p99Ms: 480 + i * 160, overheadP95Ms: 12 + i })),
    }
    return json(body)
  }),
]

export const linkHandlers = [
  route('get', '/api/links/:token', ({ params }) => {
    const t = String(params.token)
    const info: LinkInfo = t === 'expired' ? { state: 'expired' } : t === 'used' ? { state: 'used' } : t === 'foreign' ? { state: 'forbidden' }
      : { state: 'open', kind: t === 'header' ? 'header' : t === 'oauth' ? 'oauth' : 'token', upstream: { slug: 'duckdb', url: 'https://mcp.duckdb.example/mcp' }, headerName: t === 'header' ? 'X-Api-Key' : undefined, expiresAt: new Date(Date.now() + 14 * 60_000).toISOString() }
    if (info.state === 'forbidden') return err(403, 'forbidden', 'Dieser Link gehört einem anderen Nutzer.')
    return json(info)
  }, { public: true }),
  route('post', '/api/links/:token/test', async ({ request }) => {
    const b = await request.json().catch(() => ({})) as { value?: string }
    return json(b.value === 'wrong' ? { ok: false, message: 'Der Upstream hat das Token abgelehnt.' } : { ok: true, toolCount: 14 })
  }),
  route('post', '/api/links/:token/submit', () => json({ ok: true })),
]
