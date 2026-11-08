import type { CallToolResult, Tool } from '@modelcontextprotocol/client'
import { mergeTimeouts } from '../config'
import type { AuthContext, ToolDef, ToolSource } from '../ports'
import { ToolNotFoundError } from '../ports'
import type { StatsBuffer, CallStatRow } from '../stats/buffer'
import type { Catalog } from '../upstream/catalog'
import { classifyError } from '../upstream/errors'
import type { Limiter } from '../upstream/limiter'
import { PoolLimitError, type Pool } from '../upstream/pool'
import { namespaced, parseToolName, SLUG_RE } from '../upstream/slug'
import type { UpstreamHealth } from '../upstream/status'
import type { GatewayStore, UpstreamRow } from '../upstream/types'
import { upstreamContext } from '../upstream/context'
import { errorResult, type GatewayErrorCode } from './errors'
import { isStatsWindow, type StatsQuery } from '../stats/query'
import type { StatsSummary } from '#shared/api-types'

/** Name of the built-in statistics tool; it has no `__`, so it can never collide with `<slug>__<tool>`. */
export const GET_STATS_TOOL = 'get_stats'
export const GET_STATS_DEF: ToolDef = {
  name: GET_STATS_TOOL,
  description: 'Statistics of your own tool calls through mcpwarden: number of calls, success rate, results per status and latency percentiles (p5/p50/p75/p95/p99, gateway overhead) per upstream. Metadata only, never contents.',
  inputSchema: {
    type: 'object',
    properties: {
      window: { type: 'string', enum: ['5m', '1h', '24h', '7d'], description: 'Time window, default 24h' },
      upstream: { type: 'string', description: 'Upstream slug to narrow the figures to one upstream' },
      tool: { type: 'string', description: 'Tool name (without the upstream prefix) to narrow the figures to one tool' },
    },
  },
}

export type CoreDeps = {
  store: GatewayStore
  pool: Pool
  catalog: Catalog
  limiter: Limiter
  stats: StatsBuffer
  healthFor: (up: UpstreamRow) => UpstreamHealth
  now?: () => number
  /** Called when a user's catalog changes (notifyToolsChanged, 1.2.8). */
  notifyChanged?: (userId: string) => void
  /** Read side of the measurement data; without it the `get_stats` tool is not offered. */
  statsRead?: (q: StatsQuery) => Promise<StatsSummary>
}

/**
 * Key of the token limit: an OAuth client of a user (not the individual JWT, whose `jti` changes on every renewal and
 * would fill the memory), a PAT via its stable ID.
 */
export const limiterTokenKey = (ctx: AuthContext) => (ctx.clientId ? `${ctx.clientId}:${ctx.userId}` : ctx.tokenId)

const bytes = (v: unknown) => { try { return JSON.stringify(v)?.length ?? 0 } catch { return 0 } }

export class GatewayCore implements ToolSource {
  draining = false
  private active = new Set<AbortController>()
  constructor(private d: CoreDeps) {}

  private stat(ctx: AuthContext, up: UpstreamRow | null, slug: string, partial: Partial<CallStatRow> & Pick<CallStatRow, 'kind' | 'status' | 'totalMs'>) {
    this.d.stats.push({
      ts: new Date(), userId: ctx.userId, clientId: ctx.clientId, tokenId: ctx.tokenId, upstreamId: up?.id ?? null, upstreamSlug: slug,
      tool: null, upstreamMs: null, overheadMs: null, retries: 0, reqBytes: 0, resBytes: 0, cacheHit: false, ...partial,
    })
  }

  async listTools(ctx: AuthContext): Promise<ToolDef[]> {
    const t0 = performance.now()
    const ups = (await this.d.store.listEnabledUpstreams(ctx.userId)).filter(u => !ctx.upstreamIds || ctx.upstreamIds.includes(u.id))
    const parts = await Promise.all(ups.map(async (up) => {
      if (up.userId !== ctx.userId) return [] // Defense: the store must never return foreign rows
      if (up.setup !== 'ready') return []
      const h = this.d.healthFor(up)
      const u0 = performance.now()
      let tools: Tool[]
      let hit = false
      let status: CallStatRow['status'] = 'ok'
      try {
        // Cache hits do not touch the breaker: no success without upstream contact, no consumed half-open admission
        if (this.d.catalog.isFresh(up)) {
          const r = await this.d.catalog.list(up, undefined, undefined, ctx.userId)
          tools = r.tools; hit = r.cacheHit
        } else {
          if (!h.breaker.allow()) throw Object.assign(new Error('breaker'), { breaker: true })
          const r = await upstreamContext.run({ upstreamId: up.id }, () => this.d.catalog.list(up, undefined, undefined, ctx.userId))
          tools = r.tools; hit = r.cacheHit
          h.success()
        }
      } catch (e) {
        const stale = this.d.catalog.cached(up)
        status = (e as { breaker?: boolean }).breaker ? 'breaker_open' : 'upstream_error'
        if (!(e as { breaker?: boolean }).breaker) {
          const c = classifyError(e, { hasAuth: up.authType !== 'none' })
          h.failure(c.auth ? 'auth' : c.code === 'timeout' ? 'timeout' : c.status && c.status >= 500 ? 'http5xx' : 'connect')
        }
        if (!stale) { this.stat(ctx, up, up.slug, { kind: 'list', status, totalMs: Math.round(performance.now() - u0) }); return [] }
        tools = stale.tools
      }
      const flags = await this.d.store.toolFlags(up.userId, up.id)
      const out = tools.filter(x => flags.get(x.name) !== false).map(x => ({ ...x, name: namespaced(up.slug, x.name) }))
      const ms = Math.round(performance.now() - u0)
      this.stat(ctx, up, up.slug, { kind: 'list', status, totalMs: ms, upstreamMs: hit ? 0 : ms, cacheHit: hit, resBytes: bytes(out) })
      return out
    }))
    void t0
    const out = parts.flat() as ToolDef[]
    return this.d.statsRead ? [...out, GET_STATS_DEF] : out
  }

  async callTool(ctx: AuthContext, name: string, args: Record<string, unknown>, opts: { signal: AbortSignal }): Promise<CallToolResult> {
    const t0 = performance.now()
    if (name === GET_STATS_TOOL && this.d.statsRead) return await this.getStats(ctx, args)
    const parsed = parseToolName(name)
    if (!parsed) throw new ToolNotFoundError(name)
    const up = await this.d.store.getUpstreamBySlug(ctx.userId, parsed.slug)
    if (!up || !up.enabled || up.userId !== ctx.userId || (ctx.upstreamIds && !ctx.upstreamIds.includes(up.id))) throw new ToolNotFoundError(name)
    // The filter is checked server-side on EVERY call; unknown names are first synchronized against the catalog.
    let flags = await this.d.store.toolFlags(up.userId, up.id)
    if (!flags.has(parsed.tool) && up.setup === 'ready') {
      try { await this.d.catalog.list(up, opts.signal, undefined, ctx.userId); flags = await this.d.store.toolFlags(up.userId, up.id) } catch { /* unbekannt bleibt unbekannt */ }
    }
    if (flags.get(parsed.tool) !== true) throw new ToolNotFoundError(name)

    const done = (res: CallToolResult, status: CallStatRow['status'], upstreamMs: number | null, retries = 0): CallToolResult => {
      const total = Math.round(performance.now() - t0)
      this.stat(ctx, up, up.slug, { kind: 'call', status, tool: parsed.tool, totalMs: total, upstreamMs: upstreamMs === null ? null : Math.round(upstreamMs), overheadMs: upstreamMs === null ? null : Math.max(0, Math.round(total - upstreamMs)), retries, reqBytes: bytes(args), resBytes: bytes(res) })
      return res
    }
    const fail = (code: GatewayErrorCode, text: string, status: CallStatRow['status'], meta?: Record<string, unknown>) => done(errorResult(code, text, meta), status, null)

    if (this.draining) return fail('draining', 'Gateway fährt herunter', 'upstream_error')
    if (up.setup !== 'ready') return fail('awaiting_auth', 'Upstream ist noch nicht eingerichtet (Zugangsdaten fehlen)', 'denied')
    const limits = await this.d.store.getLimits(ctx.userId)
    const lease = this.d.limiter.acquire({ userId: ctx.userId, tokenId: limiterTokenKey(ctx), upstreamId: up.id, userPerMin: limits.callsPerMin, ratePerMin: up.ratePerMin, maxConcurrent: up.maxConcurrent })
    if (!lease.ok) {
      return fail('rate_limited', `Rate-Limit erreicht (${lease.scope}). Erneut versuchen in ${lease.retryAfterSec} s.`, 'rate_limited', { retry_after: lease.retryAfterSec, limit_scope: lease.scope === 'concurrency' ? 'upstream' : lease.scope })
    }
    const h = this.d.healthFor(up)
    if (!h.breaker.allow()) {
      lease.release()
      return fail('breaker_open', `Upstream vorübergehend gesperrt (Breaker offen), erneut versuchen später.`, 'breaker_open', h.breaker.nextRetryAt ? { retry_after: Math.max(1, Math.ceil((h.breaker.nextRetryAt - Date.now()) / 1000)) } : undefined)
    }
    const ctl = new AbortController()
    this.active.add(ctl)
    const onAbort = () => ctl.abort()
    opts.signal.addEventListener('abort', onAbort, { once: true })
    const t = mergeTimeouts(up.timeouts)
    const u0 = performance.now()
    try {
      return await upstreamContext.run({ upstreamId: up.id }, async () => {
      const entry = await this.d.pool.get(up, ctl.signal, ctx.userId)
      entry.inflight++
      try {
        const sig = AbortSignal.any([ctl.signal, AbortSignal.timeout(t.callMs)])
        // NO retry on tools/call (non-idempotent).
        const res = await entry.client.callTool({ name: parsed.tool, arguments: args }, { signal: sig, timeout: t.callMs, maxTotalTimeout: t.callMs }) as CallToolResult
        h.success()
        return done(res, res.isError ? 'tool_error' : 'ok', performance.now() - u0, entry.retries)
      } finally { entry.inflight-- }
      })
    } catch (e) {
      if (e instanceof PoolLimitError) { h.breaker.cancelProbe(); return fail('limit', 'Verbindungslimit erreicht', 'upstream_error') }
      const c = classifyError(e, { hasAuth: up.authType !== 'none', aborted: opts.signal.aborted })
      if (c.auth) h.failure('auth')
      else if (c.counts) h.failure(c.code === 'timeout' ? 'timeout' : c.status && c.status >= 500 ? 'http5xx' : 'connect')
      else h.breaker.cancelProbe()
      const status: CallStatRow['status'] = c.code === 'timeout' ? 'timeout' : 'upstream_error'
      return done(errorResult(c.code as GatewayErrorCode, c.message), status, performance.now() - u0)
    } finally {
      opts.signal.removeEventListener('abort', onAbort)
      this.active.delete(ctl)
      lease.release()
    }
  }

  /** `get_stats`: the user's own figures (from the auth context), narrowed by the token's upstream restriction. Never throws. */
  private async getStats(ctx: AuthContext, args: Record<string, unknown>): Promise<CallToolResult> {
    const window = args.window ?? '24h'
    const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
    const upstream = text(args.upstream)
    if (!isStatsWindow(window) || (args.upstream !== undefined && (!upstream || !SLUG_RE.test(upstream))) || (args.tool !== undefined && (!text(args.tool) || String(args.tool).length > 256))) {
      return errorResult('invalid_arguments', 'Ungültige Argumente: window (5m, 1h, 24h, 7d), upstream (Slug), tool (Name)')
    }
    try {
      const summary = await this.d.statsRead!({ userId: ctx.userId, window, upstream, tool: text(args.tool), upstreamIds: ctx.upstreamIds ?? null })
      return { content: [{ type: 'text', text: JSON.stringify(summary) }], structuredContent: summary as unknown as Record<string, unknown> }
    } catch {
      return errorResult('internal', 'Statistik vorübergehend nicht verfügbar')
    }
  }

  /** Shutdown: wait until running calls are done (max `ms`), then abort. */
  async drain(ms: number) {
    this.draining = true
    const end = Date.now() + ms
    while (this.active.size && Date.now() < end) await new Promise(r => setTimeout(r, 25))
    for (const c of this.active) c.abort()
  }
  get activeCalls() { return this.active.size }
}
