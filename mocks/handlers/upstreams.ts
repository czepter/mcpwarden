import type { SecretInput, UpstreamTestResult, UpstreamDetail, UpstreamInput, UpstreamList, UpstreamPatch, UpstreamSummary, UpstreamToolItem } from '#shared/api-types'
import { seedTools } from '../seed'
import { getState, role, save, scenario } from '../state'
import { body, err, json, nid, noContent, route } from '../util'

const SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/
const find = (id: unknown) => getState().upstreams.find(u => u.id === id)
const NF = () => err(404, 'not_found', 'Upstream nicht gefunden.')

function recount(u: UpstreamDetail) {
  const t = getState().tools[u.id] ?? []
  u.toolsTotal = t.filter(x => !x.gone).length
  u.toolsEnabled = t.filter(x => !x.gone && x.enabled).length
}

function toSummary(u: UpstreamDetail): UpstreamSummary {
  const { id, slug, name, description, type, url, command, enabled, status, statusReason, statusChangedAt, lastError, lastOkAt, setup, toolsEnabled, toolsTotal, nextRetryAt, rateLimitHits5m, hasSecret, p95Ms, recent } = u
  return { id, slug, name, description, type, url, command, enabled, status, statusReason, statusChangedAt, lastError, lastOkAt, setup, toolsEnabled, toolsTotal, nextRetryAt, rateLimitHits5m, hasSecret, ...(p95Ms !== undefined && { p95Ms }), ...(recent && { recent }) }
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
    return json<UpstreamList>({ items: (sc === 'huge' ? huge() : getState().upstreams).map(toSummary) })
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
    const auth = b.authType ?? 'none'
    const u: UpstreamDetail = {
      id: nid('up'), slug: b.slug, name: b.name.trim(), description: b.description ?? null, type: b.type,
      url: b.url ?? null, command: b.command ?? null, enabled: true, status: 'unknown', statusReason: null, statusChangedAt: null, lastError: null, lastOkAt: null,
      setup: auth !== 'none' ? 'awaiting_auth' : 'ready', toolsEnabled: 0, toolsTotal: 0, nextRetryAt: null, rateLimitHits5m: 0, hasSecret: false,
      transport: b.transport ?? 'auto', authType: auth, authHeaderName: b.authHeaderName ?? null,
      ratePerMin: b.ratePerMin ?? 60, maxConcurrent: b.maxConcurrent ?? 5,
      timeouts: { connectMs: 10_000, listMs: 15_000, callMs: 60_000, ...b.timeouts },
      args: b.args ?? [], cwd: b.cwd ?? null, env: {}, secretNames: Object.keys(b.env ?? {}), version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    s.upstreams.push(u); s.tools[u.id] = []; save()
    return json(u, 201)
  }),
  route('get', '/api/upstreams/:id', ({ params }) => { const u = find(params.id); return u ? json(u) : NF() }),
  route('patch', '/api/upstreams/:id', async ({ params, request }) => {
    const u = find(params.id); if (!u) return NF()
    const b = await body<UpstreamPatch & { slug?: string }>(request)
    if (b.slug && b.slug !== u.slug) return err(422, 'slug_immutable', 'Der Kurzname kann nicht geändert werden.', 'slug')
    if (b.enabled !== undefined) { u.enabled = b.enabled; u.status = b.enabled ? 'unknown' : 'disabled'; u.statusReason = b.enabled ? null : 'Vom Nutzer deaktiviert.' }
    const { enabled: _e, timeouts, ...rest } = b
    Object.assign(u, rest); if (timeouts) u.timeouts = { ...u.timeouts, ...timeouts }
    u.updatedAt = new Date().toISOString(); u.version++; save(); return json(u)
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
  route('post', '/api/upstreams/:id/test', ({ params }) => {
    const u = find(params.id); if (!u) return NF()
    const s = getState()
    let res: UpstreamTestResult
    if (u.setup === 'awaiting_auth') res = { ok: false, errorCode: 'awaiting_auth', message: 'Es fehlen noch Anmeldedaten.' }
    else if (u.slug === 'sentry') res = { ok: false, errorCode: 'unauthorized', message: 'Der Upstream hat die Anmeldung abgelehnt (401).', latencyMs: 180 }
    else if (u.slug.startsWith('postgres') || u.slug.startsWith('down')) res = { ok: false, errorCode: 'connect_failed', message: 'Verbindung nicht möglich.', latencyMs: 10_000 }
    else if (u.type === 'http' && /localhost|127\.0\.0\.1|169\.254/.test(u.url ?? '')) res = { ok: false, errorCode: 'ssrf_blocked', message: 'Ziel nicht erlaubt (SSRF-Schutz).' }
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
