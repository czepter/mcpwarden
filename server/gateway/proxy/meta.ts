/**
 * Meta-tool mode (per user, `user_preference.tool_mode = 'meta'`): instead of the whole catalog the client sees only
 * `find_tools`, `describe_tool` and `invoke_tool` (plus the always visible built-in tools such as `get_stats`).
 * This is a thin layer in front of the real tool source: `invoke_tool` calls `inner.callTool`, so the checks that matter
 * (tool exists, belongs to the caller, enabled, upstream ready, token restriction, limits, breaker) run on EVERY call exactly
 * as for a direct call. A name taken from `find_tools` grants nothing; a guessed or invented name is rejected the same way.
 */
import type { CallToolResult } from '@modelcontextprotocol/server'
import type { ToolMode } from '#shared/api-types'
import type { AuthContext, ToolDef, ToolSource } from '../ports'
import { ToolNotFoundError } from '../ports'
import type { StatsBuffer, CallStatRow } from '../stats/buffer'
import { errorResult } from './errors'
import { DEFAULT_LIMIT, MAX_LIMIT, rankTools } from './search'

export const FIND_TOOLS = 'find_tools'
export const DESCRIBE_TOOL = 'describe_tool'
export const INVOKE_TOOL = 'invoke_tool'
export const META_TOOL_NAMES: readonly string[] = [FIND_TOOLS, DESCRIBE_TOOL, INVOKE_TOOL]

export const META_DEFS: ToolDef[] = [
  {
    name: FIND_TOOLS,
    description: 'Search the tools available to you by intent or keywords (for example "search issues about login"). Returns ranked candidates with name and short description. Call describe_tool for the full input schema, then invoke_tool.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What you want to do, in a few words' }, limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Maximum number of candidates, default ${DEFAULT_LIMIT}` } }, required: ['query'] },
  },
  {
    name: DESCRIBE_TOOL,
    description: 'Return the full definition (description and input schema) of one tool found with find_tools.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Tool name as returned by find_tools, e.g. linear__list_issues' } }, required: ['name'] },
  },
  {
    name: INVOKE_TOOL,
    description: 'Call a tool by name with arguments that match its input schema. The tool must be available to you; unknown or disabled tools are rejected.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Tool name' }, arguments: { type: 'object', description: 'Arguments for the tool' } }, required: ['name'] },
  },
]

/** Rough context cost of the meta surface, same estimate as the dashboard uses for the full list (bytes / 4). */
export const metaContextTokens = (extra: ToolDef[] = []) => Math.round(JSON.stringify([...META_DEFS, ...extra]).length / 4)

export type MetaDeps = {
  inner: ToolSource
  getMode: (userId: string) => Promise<ToolMode>
  /** Tools that stay directly visible in meta mode (built-in management/statistics tools). */
  alwaysVisible?: () => ToolDef[]
  stats?: StatsBuffer
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined)
const short = (s: string | undefined, n = 240) => (!s ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s)

export class MetaToolSource implements ToolSource {
  constructor(private d: MetaDeps) {}

  /** Routing steps are measurement rows of kind `list` (they never count as upstream calls in the statistics). */
  private record(ctx: AuthContext, tool: string | null, status: CallStatRow['status'], t0: number, resBytes: number, reqBytes = 0) {
    this.d.stats?.push({
      ts: new Date(), userId: ctx.userId, clientId: ctx.clientId, tokenId: ctx.tokenId, upstreamId: null, upstreamSlug: 'mcpwarden', tool, kind: 'list', status,
      totalMs: Math.round(performance.now() - t0), upstreamMs: null, overheadMs: null, retries: 0, reqBytes, resBytes, cacheHit: false,
    })
  }

  async listTools(ctx: AuthContext): Promise<ToolDef[]> {
    if (await this.d.getMode(ctx.userId) !== 'meta') return this.d.inner.listTools(ctx)
    const t0 = performance.now()
    const out = [...META_DEFS, ...(this.d.alwaysVisible?.() ?? [])]
    this.record(ctx, null, 'ok', t0, JSON.stringify(out).length)
    return out
  }

  async callTool(ctx: AuthContext, name: string, args: Record<string, unknown>, opts: { signal: AbortSignal }): Promise<CallToolResult> {
    // In direct mode the meta tools do not exist: the inner source rejects the name like any unknown tool.
    if (!META_TOOL_NAMES.includes(name) || await this.d.getMode(ctx.userId) !== 'meta') return this.d.inner.callTool(ctx, name, args, opts)
    const t0 = performance.now()
    const reqBytes = JSON.stringify(args ?? {}).length
    const done = (res: CallToolResult, status: CallStatRow['status'] = res.isError ? 'tool_error' : 'ok') => {
      this.record(ctx, name, status, t0, JSON.stringify(res).length, reqBytes)
      return res
    }
    if (name === FIND_TOOLS) {
      const query = text(args.query, 512)
      const limit = args.limit === undefined ? DEFAULT_LIMIT : Number(args.limit)
      if (!query || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return done(errorResult('invalid_arguments', `Ungültige Argumente: query (Text, höchstens 512 Zeichen), limit (1 bis ${MAX_LIMIT})`))
      const ranked = rankTools(query, await this.d.inner.listTools(ctx), limit)
      const candidates = ranked.map(r => ({ name: r.tool.name, description: short(r.tool.description), score: Math.round(r.score * 100) / 100 }))
      const body = { candidates, total: candidates.length }
      return done({ content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body })
    }
    const target = text(args.name, 256)
    if (!target) return done(errorResult('invalid_arguments', 'Ungültige Argumente: name (Text)'))
    if (name === DESCRIBE_TOOL) {
      // Looked up in the caller's own, already filtered catalog: foreign, disabled or restricted tools simply do not appear.
      const def = (await this.d.inner.listTools(ctx)).find(t => t.name === target && !META_TOOL_NAMES.includes(t.name))
      if (!def) return done(errorResult('not_found', `Tool nicht gefunden: ${target}`), 'denied')
      return done({ content: [{ type: 'text', text: JSON.stringify(def) }], structuredContent: def as unknown as Record<string, unknown> })
    }
    // invoke_tool: no shortcut. The inner source repeats owner, enabled flag, token restriction, readiness, limits and breaker.
    const rawArgs = args.arguments ?? {}
    if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) return done(errorResult('invalid_arguments', 'Ungültige Argumente: arguments muss ein Objekt sein'))
    if (META_TOOL_NAMES.includes(target)) { this.record(ctx, name, 'denied', t0, 0, reqBytes); throw new ToolNotFoundError(target) }
    try {
      const res = await this.d.inner.callTool(ctx, target, rawArgs as Record<string, unknown>, opts)
      this.record(ctx, name, res.isError ? 'tool_error' : 'ok', t0, 0, reqBytes)
      return res
    } catch (e) {
      this.record(ctx, name, 'denied', t0, 0, reqBytes)
      throw e
    }
  }
}
