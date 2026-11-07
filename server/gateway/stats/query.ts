/**
 * Read side of the measurement data (spec P0-15): key figures, calls over time, results per status and percentile rows.
 * Percentiles are computed with `percentile_cont` straight on the raw data (same SQL in Postgres and PGlite).
 * Only `kind = 'call'` rows count as calls; `tools/list` rows are left out. Metadata only, never contents.
 */
import { sql, type SQL } from 'drizzle-orm'
import type { AdminStats, CallOutcome, HealthHistory, HealthHour, StatsRow, StatsSummary, StatsTool, StatsWindow, UpstreamStats } from '#shared/api-types'
import type { Db } from '../../db'

export const STATS_WINDOWS: Record<StatsWindow, number> = { '5m': 300_000, '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 }
export const isStatsWindow = (v: unknown): v is StatsWindow => typeof v === 'string' && Object.hasOwn(STATS_WINDOWS, v)
export const OUTCOMES: CallOutcome[] = ['ok', 'tool_error', 'timeout', 'upstream_error', 'rate_limited', 'breaker_open', 'denied']
/** The time series always has this many buckets (window / 24), so the chart keeps its shape for every window. */
export const SERIES_BUCKETS = 24

export type StatsQuery = {
  /** Always the session user. `undefined` is the instance-wide view and only the admin service may ask for it. */
  userId?: string
  window: StatsWindow
  /** Upstream slug; the slug survives deleting the upstream, so old measurements stay reachable. */
  upstream?: string
  tool?: string
  /** Token restriction (PAT scoped to some upstreams): only these upstreams count. */
  upstreamIds?: string[] | null
}

type Rows = Array<Record<string, unknown>>
const rowsOf = (r: unknown): Rows => (Array.isArray(r) ? r : ((r as { rows?: Rows }).rows ?? []))
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const round = (v: unknown) => Math.round(n(v))

export async function queryStats(db: Db, q: StatsQuery, now = new Date()): Promise<StatsSummary> {
  const spanMs = STATS_WINDOWS[q.window]
  const since = new Date(now.getTime() - spanMs)
  const where: SQL[] = [sql`kind = 'call'`, sql`ts > ${since}`, sql`ts <= ${now}`]
  if (q.userId) where.push(sql`user_id = ${q.userId}`)
  if (q.upstream) where.push(sql`upstream_slug = ${q.upstream}`)
  if (q.tool) where.push(sql`tool = ${q.tool}`)
  if (q.upstreamIds) where.push(q.upstreamIds.length ? sql`upstream_id in (${sql.join(q.upstreamIds.map(i => sql`${i}::uuid`), sql`, `)})` : sql`false`)
  const cond = sql.join(where, sql` and `)
  const run = async (query: SQL) => rowsOf(await db.execute(query))

  const startSec = since.getTime() / 1000
  const stepSec = spanMs / 1000 / SERIES_BUCKETS
  const [totals, buckets, outcomes, perUpstream, peak, perTool] = await Promise.all([
    run(sql`select count(*) as calls, count(*) filter (where status = 'ok') as ok, count(distinct coalesce(client_id, 'pat:' || coalesce(token_id, ''))) as clients,
      avg(total_ms) as avg_ms, max(total_ms) as max_ms, percentile_cont(0.95) within group (order by overhead_ms) as oh95 from call_stat where ${cond}`),
    run(sql`select least(${SERIES_BUCKETS - 1}, floor((extract(epoch from ts) - ${startSec}::double precision) / ${stepSec}::double precision))::int as b, count(*) as calls from call_stat where ${cond} group by 1`),
    run(sql`select status, count(*) as calls from call_stat where ${cond} group by 1`),
    run(sql`select upstream_slug as upstream, count(*) as calls, count(*) filter (where status = 'ok') as ok,
      percentile_cont(0.05) within group (order by total_ms) as p5, percentile_cont(0.5) within group (order by total_ms) as p50,
      percentile_cont(0.75) within group (order by total_ms) as p75, percentile_cont(0.95) within group (order by total_ms) as p95,
      percentile_cont(0.99) within group (order by total_ms) as p99, percentile_cont(0.95) within group (order by overhead_ms) as oh95
      from call_stat where ${cond} group by upstream_slug order by count(*) desc, upstream_slug`),
    // Peak of simultaneous calls: +1 at the start (ts minus total duration), -1 at the end; the end sorts first on a tie.
    run(sql`select coalesce(max(running), 0) as peak from (
      select sum(d) over (order by t, d rows unbounded preceding) as running from (
        select ts - make_interval(secs => total_ms / 1000.0) as t, 1 as d from call_stat where ${cond}
        union all select ts as t, -1 as d from call_stat where ${cond}
      ) ev
    ) x`),
    run(sql`select upstream_slug as upstream, tool, count(*) as calls, count(*) filter (where status = 'ok') as ok,
      percentile_cont(0.5) within group (order by total_ms) as p50, percentile_cont(0.95) within group (order by total_ms) as p95,
      percentile_cont(0.99) within group (order by total_ms) as p99, avg(total_ms) as avg_ms, max(total_ms) as max_ms
      from call_stat where ${cond} group by upstream_slug, tool order by count(*) desc, upstream_slug, tool limit 200`),
  ])

  const calls = n(totals[0]?.calls)
  const byBucket = new Map(buckets.map(r => [n(r.b), n(r.calls)]))
  const byStatus = new Map(outcomes.map(r => [String(r.status), n(r.calls)]))
  const bucketMs = spanMs / SERIES_BUCKETS
  const rows: StatsRow[] = perUpstream.map(r => ({
    upstream: String(r.upstream), calls: n(r.calls), okRate: n(r.calls) ? n(r.ok) / n(r.calls) : 0,
    p5Ms: round(r.p5), p50Ms: round(r.p50), p75Ms: round(r.p75), p95Ms: round(r.p95), p99Ms: round(r.p99), overheadP95Ms: round(r.oh95),
  }))
  return {
    window: q.window,
    calls,
    callsPerMin: Math.round((calls / (spanMs / 60_000)) * 100) / 100,
    okRate: calls ? n(totals[0]?.ok) / calls : 0,
    peakConcurrent: n(peak[0]?.peak),
    activeClients: n(totals[0]?.clients),
    avgMs: round(totals[0]?.avg_ms), maxMs: n(totals[0]?.max_ms), overheadP95Ms: round(totals[0]?.oh95),
    perHour: Array.from({ length: SERIES_BUCKETS }, (_, i) => ({ t: new Date(since.getTime() + i * bucketMs).toISOString(), calls: byBucket.get(i) ?? 0 })),
    outcomes: OUTCOMES.map(outcome => ({ outcome, count: byStatus.get(outcome) ?? 0 })),
    rows,
    tools: perTool.map((r): StatsTool => ({
      upstream: String(r.upstream), tool: r.tool === null ? '' : String(r.tool), calls: n(r.calls), okRate: n(r.calls) ? n(r.ok) / n(r.calls) : 0,
      p50Ms: round(r.p50), p95Ms: round(r.p95), p99Ms: round(r.p99), avgMs: round(r.avg_ms), maxMs: n(r.max_ms),
    })),
  }
}

// ---------- Upstream detail ----------

const ERROR_STATUSES = sql`('timeout', 'upstream_error', 'breaker_open')`

export async function queryUpstreamStats(db: Db, q: { userId: string, slug: string, window: StatsWindow }, now = new Date()): Promise<UpstreamStats> {
  const spanMs = STATS_WINDOWS[q.window]
  const since = new Date(now.getTime() - spanMs)
  const cond = sql`user_id = ${q.userId} and upstream_slug = ${q.slug} and kind = 'call' and ts > ${since} and ts <= ${now}`
  const run = async (query: SQL) => rowsOf(await db.execute(query))
  const startSec = since.getTime() / 1000
  const stepSec = spanMs / 1000 / SERIES_BUCKETS
  const base7 = new Date(now.getTime() - STATS_WINDOWS['7d'])
  const [tot, series, errs, tools, base] = await Promise.all([
    run(sql`select count(*) as calls, count(*) filter (where status <> 'ok') as errs, percentile_cont(0.5) within group (order by total_ms) as p50,
      percentile_cont(0.95) within group (order by total_ms) as p95, percentile_cont(0.99) within group (order by total_ms) as p99,
      percentile_cont(0.95) within group (order by overhead_ms) as oh95 from call_stat where ${cond}`),
    run(sql`select least(${SERIES_BUCKETS - 1}, floor((extract(epoch from ts) - ${startSec}::double precision) / ${stepSec}::double precision))::int as b,
      percentile_cont(0.5) within group (order by total_ms) as p50, percentile_cont(0.95) within group (order by total_ms) as p95,
      percentile_cont(0.99) within group (order by total_ms) as p99 from call_stat where ${cond} group by 1`),
    run(sql`select status, count(*) as calls, avg(total_ms) as avg_ms from call_stat where ${cond} and status <> 'ok' group by status order by count(*) desc`),
    run(sql`select tool, count(*) as calls, count(*) filter (where status <> 'ok') as errs, percentile_cont(0.95) within group (order by total_ms) as p95
      from call_stat where ${cond} and tool is not null group by tool order by count(*) desc, tool limit 200`),
    run(sql`select percentile_cont(0.5) within group (order by total_ms) as p50, percentile_cont(0.95) within group (order by total_ms) as p95
      from call_stat where user_id = ${q.userId} and upstream_slug = ${q.slug} and kind = 'call' and ts > ${base7} and ts <= ${now}`),
  ])
  const calls = n(tot[0]?.calls)
  const bySeries = new Map(series.map(r => [n(r.b), r]))
  const bucketMs = spanMs / SERIES_BUCKETS
  const pick = (r: Record<string, unknown> | undefined, k: string) => (r && r[k] !== null && r[k] !== undefined ? round(r[k]) : null)
  return {
    window: q.window, calls, errorCount: n(tot[0]?.errs), errorRate: calls ? n(tot[0]?.errs) / calls : 0, callsPerMin: Math.round((calls / (spanMs / 60_000)) * 100) / 100,
    p50Ms: round(tot[0]?.p50), p95Ms: round(tot[0]?.p95), p99Ms: round(tot[0]?.p99), overheadP95Ms: round(tot[0]?.oh95),
    baseline: { p50Ms: round(base[0]?.p50), p95Ms: round(base[0]?.p95) },
    series: Array.from({ length: SERIES_BUCKETS }, (_, i) => ({ t: new Date(since.getTime() + i * bucketMs).toISOString(), p50Ms: pick(bySeries.get(i), 'p50'), p95Ms: pick(bySeries.get(i), 'p95'), p99Ms: pick(bySeries.get(i), 'p99') })),
    errors: errs.map(r => ({ outcome: String(r.status) as CallOutcome, count: n(r.calls), avgMs: round(r.avg_ms) })),
    tools: tools.map(r => ({ name: String(r.tool), calls: n(r.calls), errorRate: n(r.calls) ? n(r.errs) / n(r.calls) : 0, p95Ms: round(r.p95) })),
  }
}

// ---------- Health history (derived from the measurements) ----------

export const HISTORY_HOURS = 168
const HOUR_MS = 3_600_000
export function classifyHour(calls: number, errs: number): HealthHour {
  if (!calls) return 'none'
  const r = errs / calls
  return r < 0.05 ? 'ok' : r < 0.5 ? 'warn' : 'err'
}
/** Start of the 168-hour grid: the current full hour minus 167 hours. */
const historyStart = (now: Date) => new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - (HISTORY_HOURS - 1) * HOUR_MS)

async function hourBins(db: Db, userId: string, slug: string | null, now: Date) {
  const start = historyStart(now)
  const startSec = start.getTime() / 1000
  const slugCond = slug ? sql` and upstream_slug = ${slug}` : sql``
  const res = rowsOf(await db.execute(sql`select upstream_slug as slug, floor((extract(epoch from ts) - ${startSec}::double precision) / 3600)::int as b, count(*) as calls,
    count(*) filter (where status in ${ERROR_STATUSES}) as errs from call_stat
    where user_id = ${userId} and kind = 'call' and ts >= ${start} and ts <= ${now}${slugCond} group by 1, 2`))
  return { start, rows: res }
}

export async function queryHealthHistory(db: Db, q: { userId: string, slug: string }, now = new Date()): Promise<HealthHistory> {
  const { start, rows } = await hourBins(db, q.userId, q.slug, now)
  const hours: HealthHour[] = Array.from({ length: HISTORY_HOURS }, () => 'none')
  for (const r of rows) { const b = n(r.b); if (b >= 0 && b < HISTORY_HOURS) hours[b] = classifyHour(n(r.calls), n(r.errs)) }
  // Availability of the last 24 hours: share of hours with data that stayed free of upstream problems (`ok`).
  const last = hours.slice(-24).filter(h => h !== 'none')
  return { start: start.toISOString(), hours, availability: last.length ? last.filter(h => h === 'ok').length / last.length : null }
}

/** Per upstream: p95 in the window, the last 24 calls and the last 24 hours (for the upstream list and the detail side list). */
export async function queryUpstreamOverview(db: Db, q: { userId: string, window: StatsWindow }, now = new Date()) {
  const since = new Date(now.getTime() - STATS_WINDOWS[q.window])
  const since7 = new Date(now.getTime() - STATS_WINDOWS['7d'])
  const run = async (query: SQL) => rowsOf(await db.execute(query))
  const [p95, recent, bins] = await Promise.all([
    run(sql`select upstream_slug as slug, percentile_cont(0.95) within group (order by total_ms) as p95 from call_stat
      where user_id = ${q.userId} and kind = 'call' and ts > ${since} and ts <= ${now} group by 1`),
    run(sql`select slug, status, rn from (select upstream_slug as slug, status, row_number() over (partition by upstream_slug order by ts desc, id desc) as rn
      from call_stat where user_id = ${q.userId} and kind = 'call' and ts > ${since7} and ts <= ${now}) x where rn <= 24`),
    hourBins(db, q.userId, null, now),
  ])
  const out = new Map<string, { p95Ms: number | null, recent: HealthHour[], hourly: HealthHour[] }>()
  const ensure = (slug: string) => { let e = out.get(slug); if (!e) out.set(slug, (e = { p95Ms: null, recent: Array.from({ length: 24 }, () => 'none' as HealthHour), hourly: Array.from({ length: 24 }, () => 'none' as HealthHour) })); return e }
  for (const r of p95) ensure(String(r.slug)).p95Ms = round(r.p95)
  for (const r of recent) {
    const st = String(r.status)
    // Position from the right: newest call last.
    ensure(String(r.slug)).recent[24 - n(r.rn)] = st === 'ok' ? 'ok' : st === 'tool_error' || st === 'rate_limited' || st === 'denied' ? 'warn' : 'err'
  }
  for (const r of bins.rows) {
    const b = n(r.b) - (HISTORY_HOURS - 24)
    if (b >= 0 && b < 24) ensure(String(r.slug)).hourly[b] = classifyHour(n(r.calls), n(r.errs))
  }
  return out
}

// ---------- Instance (admin) ----------

export async function queryAdminStats(db: Db, window: StatsWindow, now = new Date()): Promise<Omit<AdminStats, 'statsDropped'>> {
  const s = await queryStats(db, { window }, now)
  const since = new Date(now.getTime() - STATS_WINDOWS[window])
  const run = async (query: SQL) => rowsOf(await db.execute(query))
  const [people, ups, p95] = await Promise.all([
    run(sql`select (select count(*) from "user") as users, (select count(distinct user_id) from call_stat where kind = 'call' and ts > ${since} and ts <= ${now}) as active`),
    run(sql`select count(*) as n from upstream`),
    run(sql`select percentile_cont(0.95) within group (order by total_ms) as p95 from call_stat where kind = 'call' and ts > ${since} and ts <= ${now}`),
  ])
  return {
    window, users: n(people[0]?.users), activeUsers: n(people[0]?.active), upstreams: n(ups[0]?.n),
    calls: s.calls, okRate: s.okRate, callsPerMin: s.callsPerMin, p95Ms: round(p95[0]?.p95), overheadP95Ms: s.overheadP95Ms, outcomes: s.outcomes,
  }
}

// ---------- Latency check (health: p95 vs 7-day baseline) ----------

export const SLOW_FACTOR = 3
/** Minimum number of ok calls: 20 in the last 15 minutes, 100 in the 7-day baseline (otherwise a few outliers would flip the status). */
export const SLOW_MIN = { recent: 20, baseline: 100 } as const
export const SLOW_RECENT_MS = 15 * 60_000

export async function querySlowUpstreams(db: Db, now = new Date()): Promise<Map<string, string>> {
  const recentSince = new Date(now.getTime() - SLOW_RECENT_MS)
  const baseSince = new Date(now.getTime() - STATS_WINDOWS['7d'])
  const res = rowsOf(await db.execute(sql`select r.upstream_id as id, r.p95 as recent, b.p95 as base from
    (select upstream_id, percentile_cont(0.95) within group (order by total_ms) as p95 from call_stat
      where kind = 'call' and status = 'ok' and upstream_id is not null and ts > ${recentSince} and ts <= ${now} group by 1 having count(*) >= ${SLOW_MIN.recent}) r
    join (select upstream_id, percentile_cont(0.95) within group (order by total_ms) as p95 from call_stat
      where kind = 'call' and status = 'ok' and upstream_id is not null and ts > ${baseSince} and ts <= ${recentSince} group by 1 having count(*) >= ${SLOW_MIN.baseline}) b
    on b.upstream_id = r.upstream_id`))
  const out = new Map<string, string>()
  for (const r of res) {
    const recent = n(r.recent); const base = n(r.base)
    if (base > 0 && recent > SLOW_FACTOR * base) out.set(String(r.id), `p95 ${Math.round(recent)} ms liegt beim ${(recent / base).toFixed(1).replace('.', ',')}-Fachen der 7-Tage-Basislinie (${Math.round(base)} ms)`)
  }
  return out
}
