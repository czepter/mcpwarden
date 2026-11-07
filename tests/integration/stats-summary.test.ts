// Spec P0-15 read side: known distribution -> percentiles within 2 %, results per status, filters, own user only, peak of
// simultaneous calls, empty window. Against the real database (PGlite/Postgres).
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createInstance, type TestInstance } from './harness'
import { ctxFor, makeGateway, sig } from '../helpers/gateway'

let inst: TestInstance
let dbMod: typeof import('../../server/db')

beforeAll(async () => {
  inst = await createInstance()
  Object.assign(process.env, {
    BASE_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    MASTER_KEY: 'ab'.repeat(32),
    DATA_DIR: inst.dataDir,
    RATE_LIMIT: 'off',
  })
  if (inst.databaseUrl) process.env.DATABASE_URL = inst.databaseUrl
  else delete process.env.DATABASE_URL
  dbMod = await import('../../server/db')
})
afterAll(async () => {
  await dbMod?.closeDb()
  await inst?.cleanup()
})

const NOW = new Date('2026-11-07T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

it('percentiles, outcomes, filters and isolation', async () => {
  const db = await dbMod.getDb()
  const { user } = await import('../../server/db/schema')
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  await db.insert(user).values([{ id: 'u1', name: 'U1', email: 'u1@example.com' }, { id: 'u2', name: 'U2', email: 'u2@example.com' }])
  const repo = new GatewayRepo(db)
  const row = (o: Record<string, unknown>) => ({
    ts: ago(60_000), userId: 'u1', clientId: 'c1', tokenId: null, upstreamId: null, upstreamSlug: 'alpha', tool: 'echo', kind: 'call' as const,
    status: 'ok' as const, totalMs: 100, upstreamMs: 90, overheadMs: 10, retries: 0, reqBytes: 1, resBytes: 1, cacheHit: false, ...o,
  })
  // alpha: durations 1..1000 ms (uniform), overhead 5 ms; 1000 calls spread over the last 20 minutes
  const alpha = Array.from({ length: 1000 }, (_, i) => row({ ts: ago(5_000 + i * 1_000), totalMs: i + 1, upstreamMs: i - 4, overheadMs: 5, clientId: i % 2 ? 'c1' : 'c2' }))
  const beta = [row({ upstreamSlug: 'beta', tool: 'other', status: 'tool_error', totalMs: 50 }), row({ upstreamSlug: 'beta', tool: 'other', status: 'timeout', totalMs: 60_000 })]
  const noise = [
    row({ kind: 'list', totalMs: 9999 }), // tools/list does not count
    row({ ts: ago(2 * 86_400_000), totalMs: 9999 }), // outside the 24 h window
    row({ userId: 'u2', totalMs: 9999 }), // foreign user
  ]
  await repo.writeStats([...alpha, ...beta, ...noise] as never)

  const s = await repo.statsSummary({ userId: 'u1', window: '24h' }, NOW)
  expect(s.calls).toBe(1002)
  expect(s.outcomes.find(o => o.outcome === 'ok')!.count).toBe(1000)
  expect(s.outcomes.find(o => o.outcome === 'tool_error')!.count).toBe(1)
  expect(s.outcomes.find(o => o.outcome === 'timeout')!.count).toBe(1)
  expect(s.okRate).toBeCloseTo(1000 / 1002, 6)
  expect(s.activeClients).toBe(2)
  expect(s.callsPerMin).toBeCloseTo(1002 / 1440, 2)
  expect(s.perHour).toHaveLength(24)
  expect(s.perHour.reduce((a, p) => a + p.calls, 0)).toBe(1002)

  const a = s.rows.find(r => r.upstream === 'alpha')!
  expect(s.rows[0]!.upstream).toBe('alpha') // most calls first
  expect(a.calls).toBe(1000)
  for (const [got, want] of [[a.p5Ms, 50], [a.p50Ms, 500], [a.p75Ms, 750], [a.p95Ms, 950], [a.p99Ms, 990]] as const) expect(Math.abs(got - want) / want).toBeLessThanOrEqual(0.02)
  expect(a.overheadP95Ms).toBe(5)

  // Filters
  const onlyBeta = await repo.statsSummary({ userId: 'u1', window: '24h', upstream: 'beta' }, NOW)
  expect(onlyBeta.calls).toBe(2); expect(onlyBeta.rows.map(r => r.upstream)).toEqual(['beta'])
  expect((await repo.statsSummary({ userId: 'u1', window: '24h', tool: 'echo' }, NOW)).calls).toBe(1000)
  expect((await repo.statsSummary({ userId: 'u1', window: '24h', upstream: 'nope' }, NOW)).calls).toBe(0)
  expect((await repo.statsSummary({ userId: 'u1', window: '24h', upstreamIds: [] }, NOW)).calls).toBe(0)

  // Windows: only the last 5 minutes
  expect((await repo.statsSummary({ userId: 'u1', window: '5m' }, NOW)).calls).toBe(2 + 295) // beta rows at -60 s, alpha i < 295
  // Isolation and empty result
  expect((await repo.statsSummary({ userId: 'u2', window: '24h' }, NOW)).calls).toBe(1)
  const empty = await repo.statsSummary({ userId: 'nobody', window: '7d' }, NOW)
  expect(empty).toMatchObject({ calls: 0, okRate: 0, peakConcurrent: 0, activeClients: 0, rows: [] })
  expect(empty.outcomes).toHaveLength(7)
})

it('peak of simultaneous calls from overlapping intervals', async () => {
  const db = await dbMod.getDb()
  const { user } = await import('../../server/db/schema')
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  await db.insert(user).values({ id: 'u3', name: 'U3', email: 'u3@example.com' })
  const repo = new GatewayRepo(db)
  const mk = (endAgo: number, totalMs: number) => ({
    ts: ago(endAgo), userId: 'u3', clientId: 'c', tokenId: null, upstreamId: null, upstreamSlug: 'x', tool: 't', kind: 'call' as const, status: 'ok' as const,
    totalMs, upstreamMs: totalMs, overheadMs: 0, retries: 0, reqBytes: 0, resBytes: 0, cacheHit: false,
  })
  // Three calls overlap between -10.0 s and -9.5 s; a fourth ends exactly when the first one starts (no overlap)
  await repo.writeStats([mk(9_000, 1_000), mk(9_000, 1_000), mk(9_200, 700), mk(11_000, 1_000)] as never)
  expect((await repo.statsSummary({ userId: 'u3', window: '5m' }, NOW)).peakConcurrent).toBe(3)
})

it('get_stats tool: offered only with a reader, own figures, validation', async () => {
  const calls: unknown[] = []
  const stub = { window: '24h', calls: 7 } as never
  const h = makeGateway({ statsRead: async (q) => { calls.push(q); return stub } })
  try {
    const ctx = ctxFor('A', { upstreamIds: ['id-1'] })
    expect((await h.gw.toolSource.listTools(ctx)).map(t => t.name)).toEqual(['get_stats'])
    const ok = await h.gw.toolSource.callTool(ctx, 'get_stats', { window: '1h', upstream: 'alpha' }, { signal: sig() })
    expect(ok.isError).toBeFalsy(); expect(JSON.parse((ok.content[0] as { text: string }).text)).toEqual({ window: '24h', calls: 7 })
    expect(calls[0]).toEqual({ userId: 'A', window: '1h', upstream: 'alpha', tool: undefined, upstreamIds: ['id-1'] })
    // The user comes from the auth context, an argument cannot redirect to another user
    await h.gw.toolSource.callTool(ctx, 'get_stats', { userId: 'B' }, { signal: sig() })
    expect((calls[1] as { userId: string }).userId).toBe('A')
    const bad = await h.gw.toolSource.callTool(ctx, 'get_stats', { window: '1y' }, { signal: sig() })
    expect(bad.isError).toBe(true); expect(calls).toHaveLength(2)
  } finally { await h.gw.shutdown(500) }
  const plain = makeGateway()
  try { expect(await plain.gw.toolSource.listTools(ctxFor('A'))).toEqual([]) } finally { await plain.gw.shutdown(500) }
})

// ---------- Upstream detail, health history, list overview, admin, dashboard ----------

const mkRow = (userId: string, slug: string, o: Record<string, unknown> = {}) => ({
  ts: ago(60_000), userId, clientId: 'c', tokenId: null, upstreamId: null, upstreamSlug: slug, tool: 't', kind: 'call' as const, status: 'ok' as const,
  totalMs: 100, upstreamMs: 90, overheadMs: 10, retries: 0, reqBytes: 0, resBytes: 0, cacheHit: false, ...o,
})

it('upstream stats: percentiles, baseline, series, errors by kind, tools', async () => {
  const db = await dbMod.getDb()
  const { user } = await import('../../server/db/schema')
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  await db.insert(user).values({ id: 'u4', name: 'U4', email: 'u4@example.com' })
  const repo = new GatewayRepo(db)
  const rows = [
    ...Array.from({ length: 100 }, (_, i) => mkRow('u4', 'lin', { ts: ago(120_000 + i * 60_000), totalMs: (i + 1) * 10, tool: i % 2 ? 'a' : 'b' })),
    mkRow('u4', 'lin', { status: 'timeout', totalMs: 60_000, tool: 'a' }), mkRow('u4', 'lin', { status: 'timeout', totalMs: 40_000, tool: 'a' }),
    mkRow('u4', 'lin', { status: 'upstream_error', totalMs: 1_800, tool: 'b' }),
    mkRow('u4', 'lin', { ts: ago(3 * 86_400_000), totalMs: 5_000 }), // in the 7 d baseline, not in 24 h
    mkRow('u4', 'other', { totalMs: 9_999 }),
  ]
  await repo.writeStats(rows as never)
  const s = await repo.upstreamStats({ userId: 'u4', slug: 'lin', window: '24h' }, NOW)
  expect(s.calls).toBe(103)
  expect(s.errorCount).toBe(3); expect(s.errorRate).toBeCloseTo(3 / 103, 6)
  expect(s.errors).toEqual([{ outcome: 'timeout', count: 2, avgMs: 50_000 }, { outcome: 'upstream_error', count: 1, avgMs: 1_800 }])
  expect(s.p50Ms).toBeGreaterThan(0); expect(s.p99Ms).toBeGreaterThanOrEqual(s.p95Ms); expect(s.p95Ms).toBeGreaterThanOrEqual(s.p50Ms)
  expect(s.series).toHaveLength(24)
  expect(s.series.some(p => p.p95Ms !== null)).toBe(true)
  expect(s.baseline.p95Ms).toBeGreaterThan(0)
  const a = s.tools.find(t => t.name === 'a')!
  expect(a.calls).toBe(52); expect(a.errorRate).toBeCloseTo(2 / 52, 6)
  // Another user's upstream with the same slug is invisible
  expect((await repo.upstreamStats({ userId: 'u3', slug: 'lin', window: '24h' }, NOW)).calls).toBe(0)
})

it('health history: hour classes, availability, list overview (p95, recent, hourly)', async () => {
  const db = await dbMod.getDb()
  const { user } = await import('../../server/db/schema')
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  const { classifyHour, HISTORY_HOURS } = await import('../../server/gateway/stats/query')
  expect([classifyHour(0, 0), classifyHour(100, 4), classifyHour(100, 5), classifyHour(10, 5), classifyHour(10, 10)]).toEqual(['none', 'ok', 'warn', 'err', 'err'])
  await db.insert(user).values({ id: 'u5', name: 'U5', email: 'u5@example.com' })
  const repo = new GatewayRepo(db)
  const NOW2 = new Date('2026-11-07T12:30:00Z') // mid-hour, so the current hour can hold data
  const hourStart = new Date(Math.floor(NOW2.getTime() / 3_600_000) * 3_600_000)
  const at = (hoursAgo: number, min = 5) => new Date(hourStart.getTime() - hoursAgo * 3_600_000 + min * 60_000)
  await repo.writeStats([
    mkRow('u5', 'x', { ts: at(0, 1) }), // current hour: ok
    mkRow('u5', 'x', { ts: at(1), status: 'timeout' }), mkRow('u5', 'x', { ts: at(1, 6) }), // 1 h ago: 50 % errors -> err
    mkRow('u5', 'x', { ts: at(2) }), mkRow('u5', 'x', { ts: at(2, 6), status: 'tool_error' }), // tool errors do not count as upstream problems
    mkRow('u5', 'x', { ts: at(30), status: 'upstream_error' }), // outside 24 h, inside 7 d
  ] as never)
  const h = await repo.healthHistory({ userId: 'u5', slug: 'x' }, NOW2)
  expect(h.hours).toHaveLength(HISTORY_HOURS)
  expect(h.hours.at(-1)).toBe('ok'); expect(h.hours.at(-2)).toBe('err'); expect(h.hours.at(-3)).toBe('ok'); expect(h.hours.at(-31)).toBe('err'); expect(h.hours.at(-4)).toBe('none')
  expect(h.availability).toBeCloseTo(2 / 3, 6) // 3 hours with data in the last 24, 2 of them ok
  const ov = (await repo.upstreamOverview({ userId: 'u5', window: '7d' }, NOW2)).get('x')!
  expect(ov.hourly.at(-1)).toBe('ok'); expect(ov.hourly.at(-2)).toBe('err')
  expect(ov.recent).toHaveLength(24); expect(ov.recent.slice(-1)).toEqual(['ok']); expect(ov.recent.slice(0, 18).every(x => x === 'none')).toBe(true)
  expect(ov.p95Ms).toBe(100)
})

it('admin stats and dashboard kpis', async () => {
  const db = await dbMod.getDb()
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  const { dashboard } = await import('../../server/gateway/service')
  const repo = new GatewayRepo(db)
  const a = await repo.adminStats('7d', NOW)
  expect(a.users).toBeGreaterThanOrEqual(5); expect(a.activeUsers).toBeGreaterThanOrEqual(3); expect(a.calls).toBeGreaterThan(1000)
  expect(a.outcomes).toHaveLength(7)
  // Dashboard of u4 over 24 h: kpis and 24 series points; calls per minute is calls / 1440
  const rt = { repo, gw: { healthFor: () => ({ breaker: { nextRetryAt: null } }), limiter: { hitsLast5m: () => 0 } } } as never
  const d = await dashboard(rt, { id: 'u4', role: 'user' }, { connections: [], window: '24h' }, NOW)
  expect(d.kpis).toMatchObject({ clientsActive: 0, clientsTotal: 0 })
  expect(d.kpis!.callsPerMin).toBeCloseTo(103 / 1440, 2)
  expect(d.kpis!.successRate).toBeCloseTo(100 / 103, 2)
  expect(d.series).toHaveLength(24)
  await expect(dashboard(rt, { id: 'u4', role: 'user' }, { connections: [], window: 'yearly' }, NOW)).rejects.toMatchObject({ statusCode: 422 })
})

it('latency check: p95 above 3x the 7-day baseline degrades, with minimum sample sizes', async () => {
  const db = await dbMod.getDb()
  const { user, upstream } = await import('../../server/db/schema')
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  const { UpstreamHealth } = await import('../../server/gateway/upstream/status')
  await db.insert(user).values({ id: 'u6', name: 'U6', email: 'u6@example.com' })
  const [slow, steady, thin] = await db.insert(upstream).values(['slow', 'steady', 'thin'].map(slug => ({ userId: 'u6', slug, name: slug, type: 'http', url: 'https://x.example/mcp' }))).returning({ id: upstream.id })
  const repo = new GatewayRepo(db)
  const row = (id: string, slug: string, ts: Date, ms: number) => mkRow('u6', slug, { ts, totalMs: ms, upstreamId: id })
  const base = (id: string, slug: string, n: number) => Array.from({ length: n }, (_, i) => row(id, slug, ago(3_600_000 + i * 60_000), 100)) // 100 ms baseline
  const recent = (id: string, slug: string, n: number, ms: number) => Array.from({ length: n }, (_, i) => row(id, slug, ago(30_000 + i * 20_000), ms))
  await repo.writeStats([
    ...base(slow!.id, 'slow', 120), ...recent(slow!.id, 'slow', 30, 450), // 4.5x -> degraded
    ...base(steady!.id, 'steady', 120), ...recent(steady!.id, 'steady', 30, 250), // 2.5x -> fine
    ...base(thin!.id, 'thin', 120), ...recent(thin!.id, 'thin', 5, 5000), // too few recent calls -> ignored
  ] as never)
  const m = await repo.slowUpstreams(NOW)
  expect([...m.keys()]).toEqual([slow!.id])
  expect(m.get(slow!.id)).toContain('4,5-Fachen')

  // The health object turns degraded with the reason and heals when the check clears it
  const changes: string[] = []
  const h = new UpstreamHealth('u6', slow!.id, { enabled: true, setup: 'ready' }, { onChange: (_i, _u, s) => { changes.push(`${s.status}:${s.reason ?? ''}`) } })
  h.success()
  h.setSlow(m.get(slow!.id)!)
  expect(h.status).toBe('degraded'); expect(h.snapshot().reason).toContain('Basislinie')
  h.setSlow(null)
  expect(h.status).toBe('healthy')
  expect(changes.map(c => c.split(':')[0])).toEqual(['healthy', 'degraded', 'healthy'])
})

it('purge: old raw rows become an hourly rollup with histogram, rollups expire after 13 months', async () => {
  const db = await dbMod.getDb()
  const { user, callStat, callStatHourly } = await import('../../server/db/schema')
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  const { ROLLUP_BUCKETS_MS } = await import('../../server/gateway/config')
  await db.insert(user).values({ id: 'u7', name: 'U7', email: 'u7@example.com' })
  const repo = new GatewayRepo(db)
  const old = new Date(NOW.getTime() - 20 * 86_400_000) // 2026-10-18 12:00
  const at = (min: number) => new Date(old.getTime() + min * 60_000)
  await repo.writeStats([
    mkRow('u7', 'r', { ts: at(5), totalMs: 5, overheadMs: 1 }), mkRow('u7', 'r', { ts: at(10), totalMs: 30, overheadMs: 2 }), mkRow('u7', 'r', { ts: at(20), totalMs: 80_000, overheadMs: null }),
    mkRow('u7', 'r', { ts: at(30), status: 'timeout', totalMs: 60_000 }), mkRow('u7', 'r', { ts: at(40), kind: 'list' }), // list rows are dropped without a rollup
    mkRow('u7', 'r', { ts: NOW }), // fresh row stays
  ] as never)
  expect(await repo.purgeStats(14, NOW)).toBe(5)
  const ok = (await db.select().from(callStatHourly)).filter(r => r.userId === 'u7' && r.status === 'ok')
  expect(ok).toHaveLength(1)
  expect(ok[0]).toMatchObject({ calls: 3, totalMsSum: 5 + 30 + 80_000, maxMs: 80_000, overheadMsSum: 3, overheadCalls: 2, tool: 't' })
  expect(ok[0]!.hist).toHaveLength(ROLLUP_BUCKETS_MS.length + 1)
  expect(ok[0]!.hist[0]).toBe(1) // <= 10 ms
  expect(ok[0]!.hist[2]).toBe(1) // 25 < 30 <= 50 ms
  expect(ok[0]!.hist.at(-1)).toBe(1) // above 60 s
  expect(ok[0]!.hist.reduce((a, b) => a + b, 0)).toBe(3)
  const raw = (await db.select().from(callStat)).filter(r => r.userId === 'u7')
  expect(raw).toHaveLength(1)

  // Same hour again later: counters add up instead of overwriting
  await repo.writeStats([mkRow('u7', 'r', { ts: at(45), totalMs: 7, overheadMs: 1 })] as never)
  await repo.purgeStats(14, NOW)
  const again = (await db.select().from(callStatHourly)).find(r => r.userId === 'u7' && r.status === 'ok')!
  expect(again.calls).toBe(4); expect(again.hist[0]).toBe(2); expect(again.maxMs).toBe(80_000)

  // Rollups older than 13 months are removed
  expect(await repo.purgeStats(14, new Date(NOW.getTime() + 400 * 86_400_000))).toBeGreaterThanOrEqual(1)
  expect((await db.select().from(callStatHourly)).filter(r => r.userId === 'u7')).toHaveLength(0)
})
