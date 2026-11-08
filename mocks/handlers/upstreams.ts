import type { RestTool, RestToolInput, RestToolList, HealthHistory, UpstreamStats, StatsWindow, SecretInput, UpstreamTestResult, UpstreamDetail, UpstreamImportInput, UpstreamImportItem, UpstreamImportResult, UpstreamInput, UpstreamList, UpstreamTagList, UpstreamPatch, UpstreamSummary, UpstreamToolItem } from '#shared/api-types'
import { seedTools } from '../seed'
import { checkRestTools, RestToolError } from '../../server/gateway/rest/template'
import { WINDOW_FACTOR, WINDOW_MIN, heatmapFor, hoursFor } from '../stats-data'
import { getState, role, save, scenario } from '../state'
import { body, err, json, nid, noContent, route } from '../util'

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/
const find = (id: unknown) => getState().upstreams.find(u => u.id === id)
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.:/-]{0,31}$/u
/** Like the server: trimmed, lowercase, de-duplicated, at most 10 of 32 characters; null = invalid. */
function normTags(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const r of v) {
    const t = typeof r === 'string' ? r.trim().toLowerCase().replace(/\s+/g, ' ') : null
    if (t === null) return null
    if (!t) continue
    if (!TAG_RE.test(t)) return null
    if (!out.includes(t)) out.push(t)
  }
  return out.length > 10 ? null : out
}
/** Same validation as the server (the module is pure); returns the tools as stored or an error response. */
function restFrom(items: unknown, hasBaseUrl: boolean): { tools: RestTool[] } | { error: Response } {
  try {
    const at = new Date().toISOString()
    return { tools: checkRestTools(items, hasBaseUrl).map((t, i) => ({ ...t, id: nid('rt') + i, createdAt: at, updatedAt: at })) as unknown as RestTool[] }
  } catch (e) {
    if (e instanceof RestToolError) return { error: err(422, 'validation', e.message, e.field ?? 'restTools') }
    throw e
  }
}
/** Registers the definitions as the upstream's tools (counts and per-tool switches keep their state by name). */
function syncRestTools(u: UpstreamDetail, tools: RestTool[]) {
  const s = getState()
  const old = new Map((s.tools[u.id] ?? []).map(t => [t.name, t]))
  s.tools[u.id] = tools.filter(t => t.enabled).map(t => old.get(t.name) ?? ({
    name: t.name, title: null, description: t.description, enabled: true, gone: false, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
    annotations: { readOnlyHint: t.method === 'GET', destructiveHint: t.method === 'DELETE' },
  }))
  u.restTools = tools; recount(u)
}
const NF = () => err(404, 'not_found', 'Upstream nicht gefunden.')

function recount(u: UpstreamDetail) {
  const t = getState().tools[u.id] ?? []
  u.toolsTotal = t.filter(x => !x.gone).length
  u.toolsEnabled = t.filter(x => !x.gone && x.enabled).length
}

function toSummary(u: UpstreamDetail): UpstreamSummary {
  const { id, slug, name, description, type, url, command, enabled, status, statusReason, statusChangedAt, lastError, lastOkAt, setup, toolsEnabled, toolsTotal, nextRetryAt, rateLimitHits5m, hasSecret, p95Ms, recent, tags } = u
  return { id, slug, name, description, type, url, command, enabled, status, statusReason, statusChangedAt, lastError, lastOkAt, setup, toolsEnabled, toolsTotal, nextRetryAt, rateLimitHits5m, hasSecret, ...(tags && { tags }), ...(p95Ms !== undefined && { p95Ms }), ...(recent && { recent }) }
}

function withStats(s: UpstreamSummary): UpstreamSummary {
  const hours = hoursFor(s.status)
  return { ...s, p95Ms: s.status === 'disabled' || s.status === 'unknown' ? null : s.status === 'degraded' ? 1240 : 212, recent: hours, hourly: hours }
}

function huge(): UpstreamDetail[] {
  const base = getState().upstreams
  return Array.from({ length: 60 }, (_, i) => ({ ...base[i % base.length]!, id: `h_${i}`, slug: `bulk-${i}`, name: `Bulk ${i}` }))
}

export const upstreamHandlers = [
  route('get', '/api/upstreams', () => {
    const sc = scenario()
    if (sc === 'empty') return json({ items: [] })
    // Summary: detail fields (env, secretNames, timeouts ...) stay in the detail (never a secret in the list).
    return json<UpstreamList>({ items: (sc === 'huge' ? huge() : getState().upstreams).map(u => withStats(toSummary(u))) })
  }),
  route('get', '/api/upstreams/:id/stats', ({ params, request }) => {
    const u = find(params.id); if (!u) return NF()
    const w = (new URL(request.url).searchParams.get('window') ?? '24h') as StatsWindow
    const f = WINDOW_FACTOR[w] ?? 1
    const bad = u.status === 'degraded' || u.status === 'open'
    const calls = Math.round(374 * f)
    const errorCount = Math.round(calls * (bad ? 0.083 : 0.012))
    const body: UpstreamStats = {
      window: w, calls, errorCount, errorRate: calls ? errorCount / calls : 0, callsPerMin: Math.round((calls / WINDOW_MIN[w]!) * 100) / 100,
      p50Ms: 312, p95Ms: bad ? 1240 : 212, p99Ms: bad ? 2100 : 340, overheadP95Ms: 18, baseline: { p50Ms: 298, p95Ms: 364 },
      series: Array.from({ length: 24 }, (_, i) => ({ t: new Date(Date.now() - ((24 - i) * WINDOW_MIN[w]! * 60_000) / 24).toISOString(), p50Ms: 300 + (i % 5) * 6, p95Ms: bad ? 400 + i * i * 1.5 : 200 + (i % 4) * 10, p99Ms: bad ? 600 + i * i * 2.6 : 330 + (i % 3) * 14 })),
      errors: bad ? [{ outcome: 'timeout', count: Math.round(19 * f), avgMs: 60000 }, { outcome: 'upstream_error', count: Math.round(9 * f), avgMs: 1800 }, { outcome: 'rate_limited', count: Math.round(3 * f), avgMs: 3 }] : [],
      tools: (getState().tools[u.id] ?? []).filter(t => !t.gone).slice(0, 8).map((t, i) => ({ name: t.name, calls: Math.round((120 - i * 12) * f), errorRate: bad ? 0.05 + i * 0.04 : 0.01, p95Ms: 400 + i * 300 })),
    }
    return json(body)
  }),
  route('get', '/api/upstreams/:id/health-history', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    const hours = heatmapFor(u.status)
    const last = hours.slice(-24).filter(h => h !== 'none')
    const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - 167 * 3_600_000).toISOString()
    return json<HealthHistory>({ start, hours, availability: last.length ? last.filter(h => h === 'ok').length / last.length : null })
  }),
  route('post', '/api/upstreams', async ({ request }) => {
    const b = await body<UpstreamInput>(request); const s = getState()
    if (!b.name?.trim()) return err(422, 'validation', 'Der Anzeigename darf nicht leer sein.', 'name')
    if (!SLUG.test(b.slug ?? '')) return err(422, 'validation', 'Kurzname: a-z, 0-9, Bindestrich, höchstens 32 Zeichen.', 'slug')
    if (s.upstreams.some(u => u.slug === b.slug)) return err(409, 'slug_taken', 'Dieser Kurzname ist schon vergeben.', 'slug')
    if (s.upstreams.length >= 50) return err(409, 'limit_reached', 'Obergrenze von 50 Upstreams erreicht.')
    if (b.type === 'stdio' && (role() !== 'admin' || !s.settings['stdio.enabled'])) return err(403, 'stdio_not_allowed', 'stdio ist für dich nicht freigegeben.')
    if (b.type === 'http' && !/^https?:\/\/[^/@\s]+(\/|$)/.test(b.url ?? '')) return err(422, 'validation', 'Gültige http(s)-URL ohne Zugangsdaten erforderlich.', 'url')
    if (b.type === 'stdio' && !b.command?.trim()) return err(422, 'validation', 'Befehl fehlt.', 'command')
    if (b.type === 'rest' && b.url && !/^https?:\/\/[^/@\s]+(\/|$)/.test(b.url)) return err(422, 'validation', 'Gültige http(s)-URL ohne Zugangsdaten erforderlich.', 'url')
    if (b.type === 'rest' && ['oauth', 'env'].includes(b.authType ?? '')) return err(422, 'validation', 'REST kennt nur Keine, Bearer und Header.', 'authType')
    const rest = b.type === 'rest' ? restFrom(b.restTools ?? [], !!b.url) : null
    if (rest && 'error' in rest) return rest.error
    const tags = b.tags === undefined ? [] : normTags(b.tags)
    if (!tags) return err(422, 'validation', 'Tags: höchstens 10, je höchstens 32 Zeichen.', 'tags')
    const auth = b.authType ?? 'none'
    const u: UpstreamDetail = {
      id: nid('up'), slug: b.slug, name: b.name.trim(), description: b.description ?? null, type: b.type, tags,
      url: b.url ?? null, command: b.command ?? null, enabled: true, status: 'unknown', statusReason: null, statusChangedAt: null, lastError: null, lastOkAt: null,
      setup: auth !== 'none' ? 'awaiting_auth' : 'ready', toolsEnabled: 0, toolsTotal: 0, nextRetryAt: null, rateLimitHits5m: 0, hasSecret: false,
      transport: b.transport ?? 'auto', authType: auth, authHeaderName: b.authHeaderName ?? null,
      ratePerMin: b.ratePerMin ?? 60, maxConcurrent: b.maxConcurrent ?? 5,
      timeouts: { connectMs: 10_000, listMs: 15_000, callMs: 60_000, ...b.timeouts },
      args: b.args ?? [], cwd: b.cwd ?? null, env: {}, secretNames: Object.keys(b.env ?? {}), version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    s.upstreams.push(u); s.tools[u.id] = []
    if (rest && 'tools' in rest) { syncRestTools(u, rest.tools); if (u.setup === 'ready') u.status = 'healthy' }
    save()
    return json(u, 201)
  }),
  route('get', '/api/upstreams/tags', () => json<UpstreamTagList>({ items: [...new Set(getState().upstreams.flatMap(u => u.tags ?? []))].sort((a, b) => a.localeCompare(b)) })),
  route('post', '/api/upstreams/import', async ({ request }) => {
    const b = await body<UpstreamImportInput>(request); const s = getState()
    let doc: { mcpServers?: Record<string, Record<string, unknown>> }
    try { doc = JSON.parse(b.json ?? '') } catch { return err(422, 'invalid_json', 'Das ist kein gültiges JSON.', 'json') }
    const servers = doc && typeof doc === 'object' && doc.mcpServers && typeof doc.mcpServers === 'object' ? doc.mcpServers : null
    if (!servers || !Object.keys(servers).length) return err(422, 'invalid_json', 'Erwartet wird ein Objekt mit „mcpServers“.', 'json')
    const taken = new Set(s.upstreams.map(u => u.slug)); const items: UpstreamImportItem[] = []
    for (const [name, e] of Object.entries(servers)) {
      const slug0 = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'mcp'
      const type = typeof e?.command === 'string' ? 'stdio' : typeof e?.url === 'string' ? 'http' : null
      if (!type) { items.push({ name, status: 'skipped', reason: 'invalid', message: 'Eintrag braucht url oder command.' }); continue }
      if (type === 'stdio' && (role() !== 'admin' || !s.settings['stdio.enabled'])) { items.push({ name, slug: slug0, type, status: 'skipped', reason: 'stdio_not_allowed', message: 'stdio ist für dich nicht freigegeben.' }); continue }
      if (type === 'http' && !/^https?:\/\/[^/@\s]+(\/|$)/.test(String(e.url))) { items.push({ name, slug: slug0, type, status: 'skipped', reason: 'invalid', message: 'url ist keine gültige Adresse.' }); continue }
      let slug = slug0
      for (let n = 2; taken.has(slug); n++) slug = `${slug0.slice(0, 28)}-${n}`
      taken.add(slug)
      if (!b.dryRun) {
        const u: UpstreamDetail = {
          id: nid('up'), slug, name, description: null, type, url: type === 'http' ? String(e.url) : null, command: type === 'stdio' ? String(e.command) : null, tags: [],
          enabled: type !== 'stdio', status: type === 'stdio' ? 'disabled' : 'unknown', statusReason: type === 'stdio' ? 'Vom Nutzer deaktiviert.' : null, statusChangedAt: null, lastError: null, lastOkAt: null,
          setup: 'ready', toolsEnabled: 0, toolsTotal: 0, nextRetryAt: null, rateLimitHits5m: 0, hasSecret: false, transport: 'auto', authType: 'none', authHeaderName: null,
          ratePerMin: 60, maxConcurrent: 5, timeouts: { connectMs: 10_000, listMs: 15_000, callMs: 60_000 }, args: Array.isArray(e.args) ? e.args.map(String) : [], cwd: null, env: {},
          secretNames: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }
        s.upstreams.push(u); s.tools[u.id] = []
      }
      items.push({ name, slug, type, status: b.dryRun ? 'would_create' : 'created' })
    }
    if (!b.dryRun) save()
    const created = items.filter(i => i.status !== 'skipped').length
    return json<UpstreamImportResult>({ items, created, skipped: items.length - created })
  }),
  route('get', '/api/upstreams/:id', ({ params }) => { const u = find(params.id); return u ? json(u) : NF() }),
  route('patch', '/api/upstreams/:id', async ({ params, request }) => {
    const u = find(params.id); if (!u) return NF()
    const b = await body<UpstreamPatch & { slug?: string }>(request)
    if (b.slug && b.slug !== u.slug) return err(422, 'slug_immutable', 'Der Kurzname kann nicht geändert werden.', 'slug')
    if (b.enabled !== undefined) { u.enabled = b.enabled; u.status = b.enabled ? 'unknown' : 'disabled'; u.statusReason = b.enabled ? null : 'Vom Nutzer deaktiviert.' }
    const { enabled: _e, timeouts, tags: tagsIn, restTools: restIn, ...rest } = b
    if (restIn !== undefined) {
      if (u.type !== 'rest') return err(422, 'validation', 'restTools gehört nur zu REST-Upstreams.', 'restTools')
      const r = restFrom(restIn, !!(rest.url ?? u.url)); if ('error' in r) return r.error
      syncRestTools(u, r.tools)
    }
    if (tagsIn !== undefined) { const t = normTags(tagsIn); if (!t) return err(422, 'validation', 'Tags: höchstens 10, je höchstens 32 Zeichen.', 'tags'); u.tags = t }
    Object.assign(u, rest); if (timeouts) u.timeouts = { ...u.timeouts, ...timeouts }
    u.updatedAt = new Date().toISOString(); u.version++; save(); return json(u)
  }),
  route('get', '/api/upstreams/:id/rest-tools', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    if (u.type !== 'rest') return err(422, 'validation', 'Nur REST-Upstreams haben REST-Tools.', 'type')
    return json<RestToolList>({ items: u.restTools ?? [] })
  }),
  route('put', '/api/upstreams/:id/rest-tools', async ({ params, request }) => {
    const u = find(params.id); if (!u) return NF()
    if (u.type !== 'rest') return err(422, 'validation', 'Nur REST-Upstreams haben REST-Tools.', 'type')
    const b = await body<{ items?: RestToolInput[] }>(request)
    const r = restFrom(b.items, !!u.url); if ('error' in r) return r.error
    syncRestTools(u, r.tools); u.version++; save()
    return json<RestToolList>({ items: r.tools })
  }),
  route('delete', '/api/upstreams/:id', ({ params }) => {
    const s = getState(); if (!find(params.id)) return NF()
    s.upstreams = s.upstreams.filter(u => u.id !== params.id); Reflect.deleteProperty(s.tools, String(params.id)); save(); return noContent()
  }),
  route('put', '/api/upstreams/:id/secret', async ({ params, request }) => {
    const u = find(params.id); if (!u) return NF()
    const b = await body<SecretInput>(request)
    if (!b.value) return err(422, 'validation', 'Das Secret darf nicht leer sein.', 'value')
    // Value is discarded: the mock never stores a secret (section 10).
    u.hasSecret = true; u.setup = 'ready'; if (b.name && !u.secretNames.includes(b.name)) u.secretNames.push(b.name)
    save(); return json({ hasSecret: true as const, setup: u.setup })
  }),
  // The mock has no authorization server: "connecting" succeeds immediately (no redirect), like a still valid session.
  route('post', '/api/upstreams/probe', async ({ request }) => {
    const b = await body<{ url?: string }>(request)
    return json({ oauth: /oauth/i.test(b.url ?? '') ? 'dcr' : 'none' })
  }),
  route('post', '/api/upstreams/:id/oauth/start', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    if (u.authType !== 'oauth') return err(422, 'validation', 'Dieser Upstream nutzt keine OAuth-Anmeldung.', 'authType')
    u.hasSecret = true; u.setup = 'ready'; if (!u.secretNames.includes('oauth')) u.secretNames.push('oauth')
    save(); return json({ authorizationUrl: null, connected: true })
  }),
  route('delete', '/api/upstreams/:id/oauth', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    u.hasSecret = false; u.setup = 'awaiting_auth'; u.secretNames = u.secretNames.filter(n => n !== 'oauth')
    save(); return noContent()
  }),
  route('post', '/api/upstreams/:id/test', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    const s = getState()
    let res: UpstreamTestResult
    if (u.setup === 'awaiting_auth') res = { ok: false, errorCode: 'awaiting_auth', message: 'Es fehlen noch Anmeldedaten.' }
    else if (u.slug === 'sentry') res = { ok: false, errorCode: 'unauthorized', message: 'Der Upstream hat die Anmeldung abgelehnt (401).', latencyMs: 180 }
    else if (u.slug.startsWith('postgres') || u.slug.startsWith('down')) res = { ok: false, errorCode: 'connect_failed', message: 'Verbindung nicht möglich.', latencyMs: 10_000 }
    else if (u.type !== 'stdio' && /localhost|127\.0\.0\.1|169\.254/.test(u.url ?? '')) res = { ok: false, errorCode: 'ssrf_blocked', message: 'Ziel nicht erlaubt (SSRF-Schutz).' }
    else {
      if (!s.tools[u.id]?.length) { s.tools[u.id] = seedTools({ ...u, toolsTotal: 5, toolsEnabled: 5 }); recount(u) }
      u.status = 'healthy'; u.statusReason = null; u.lastOkAt = new Date().toISOString(); save()
      res = { ok: true, tools: s.tools[u.id]!.map(t => ({ name: t.name, description: t.description ?? undefined })), latencyMs: 142 }
    }
    return json(res)
  }),
  route('get', '/api/upstreams/:id/tools', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    return json({ items: getState().tools[u.id] ?? [], fetchedAt: new Date().toISOString(), stale: false })
  }),
  route('put', '/api/upstreams/:id/tools/:name', async ({ params, request }) => {
    const u = find(params.id); if (!u) return NF()
    const t = getState().tools[u.id]?.find((x: UpstreamToolItem) => x.name === params.name)
    if (!t) return err(404, 'not_found', 'Tool nicht gefunden.')
    const b = await body<{ enabled: boolean }>(request)
    if (u.slug === 'github' && t.name === 'create_issue') return err(500, 'internal', 'Speichern fehlgeschlagen (Mock-Fehler).')
    t.enabled = b.enabled; recount(u); save(); return json(t)
  }),
  route('get', '/api/upstreams/:id/draft', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    return json({ id: u.id, slug: u.slug, command: u.command ?? 'uvx mcp-server-duckdb', args: u.args, cwd: 'wird vom Server festgelegt', envNames: ['MOTHERDUCK_TOKEN'], createdVia: { client: 'Claude Code', at: new Date(Date.now() - 600_000).toISOString() } })
  }),
  route('post', '/api/upstreams/:id/approve', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    u.setup = 'ready'; save(); return json({ status: 'ready' })
  }),
]
