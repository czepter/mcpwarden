import type { AuditItem, DashboardClient, CallOutcome, Dashboard, LinkInfo, StatsSummary, StatsWindow } from '#shared/api-types'
import { WINDOW_FACTOR, WINDOW_MIN, series24 } from '../stats-data'
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
  route('get', '/api/dashboard', ({ request }) => {
    const s = getState()
    const w = (new URL(request.url).searchParams.get('window') ?? '1h') as StatsWindow
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
    const perMin = Math.round(15.8 * 10) / 10
    const kpis = empty ? { clientsActive: 0, clientsTotal: 0, callsPerMin: 0, successRate: 1, overheadP95Ms: 0 }
      : { clientsActive: clients.filter(c => c.active).length, clientsTotal: clients.length, callsPerMin: perMin, successRate: 0.987, overheadP95Ms: 18 }
    return json<Dashboard>({ clients, attention, attentionCount: attention.length, kpis, series: series24(w, empty ? 0 : perMin, (i, base) => Math.max(0, Math.round((base + 6 * Math.sin(i / 3) + 3 * ((i * 7) % 5)) * 10) / 10)) })
  }),
]

const OUT: CallOutcome[] = ['ok', 'tool_error', 'timeout', 'upstream_error', 'rate_limited', 'breaker_open', 'denied']
export const statsHandlers = [
  route('get', '/api/stats/summary', ({ request }) => {
    const w = (new URL(request.url).searchParams.get('window') ?? '24h') as StatsWindow
    const only = new URL(request.url).searchParams.get('upstream')
    const only2 = new URL(request.url).searchParams.get('tool')
    const ups = getState().upstreams.filter(u => u.enabled && (!only || u.slug === only))
    const f = (WINDOW_FACTOR[w] ?? 1) * (only ? ups.length / Math.max(1, getState().upstreams.filter(u => u.enabled).length) : 1)
    const calls = Math.round(9874 * f)
    const counts = [0.947, 0.02, 0.01, 0.012, 0.006, 0.004, 0.001]
    const body: StatsSummary = {
      avgMs: 142, maxMs: 9800, overheadP95Ms: 18, window: w, calls, callsPerMin: Math.round((calls / WINDOW_MIN[w]!) * 10) / 10, okRate: 0.947, peakConcurrent: 4, activeClients: 4,
      perHour: Array.from({ length: 24 }, (_, i) => ({ t: new Date(Date.now() - (23 - i) * 3_600_000).toISOString(), calls: Math.round((300 + 250 * Math.sin(i / 3) + 80 * (i % 5)) * f) })),
      outcomes: OUT.map((outcome, i) => ({ outcome, count: Math.round(calls * counts[i]!) })),
      tools: ups.flatMap((u, i) => ['list_items', 'get_item', 'create_item'].map((t, j) => ({
        upstream: u.slug, tool: t, calls: Math.round((900 - i * 100 - j * 250) * f), okRate: 0.99 - i * 0.02 - j * 0.01, p50Ms: 40 + i * 12 + j * 30, p95Ms: 212 + i * 100 + j * 120, p99Ms: 480 + i * 160 + j * 200,
        avgMs: 80 + i * 20 + j * 40, maxMs: 4000 + i * 800,
      }))).filter(t => !only2 || t.tool === only2),
      rows: ups.map((u, i) => ({ upstream: u.slug, calls: Math.round((2400 - i * 300) * f), okRate: 0.99 - i * 0.02, p5Ms: 20 + i, p50Ms: 60 + i * 12, p75Ms: 110 + i * 20, p95Ms: 212 + i * 100, p99Ms: 480 + i * 160, overheadP95Ms: 12 + i })),
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
