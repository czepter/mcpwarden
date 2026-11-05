/**
 * Anwendungslogik für Upstreams, Tools, Capabilities, Dashboard und Admin. Die Routen unter server/api/** sind
 * dünne Hüllen; hier liegt Validierung, Berechtigung, Audit und die Abstimmung mit Pool/Katalog/Status.
 */
import { createError } from 'h3'
import type {
  AdminSettings, AdminSettingsResult, AdminUser, AdminUserList, AdminUserLimitsInput, AuditItem, Capabilities, Dashboard, InviteSummary,
  UpstreamDetail, UpstreamSummary, UpstreamTestResult, UpstreamToolList, UserLimits,
} from '#shared/api-types'
import { apiError } from '../utils/api'
import { trySendMail, type Mailer } from '../mail'
import { inviteMail } from '../mail/templates'
import { audit, type AuditAction } from '../utils/audit'
import { isValidSlug } from './upstream/slug'
import { ACTIVE_WINDOW_MS, DEFAULT_LIMITS, TIMEOUTS, mergeTimeouts, type Timeouts } from './config'
import { assertUrlAllowed, SsrfBlockedError, validateAllowEntry, AllowList } from './net/ssrf'
import { encryptSecret } from './crypto/secrets'
import { classifyError } from './upstream/errors'
import { LimitReached, SlugTaken, type NewUpstream } from './upstream/repo'
import type { Runtime } from './runtime'
import { getMasterKey } from '../utils/master-key'
import { notifyToolsChanged, closeUserStreams } from '../mcp/notify'
import { UUID_RE } from '../auth/dcr-store'
import { runUserBanned, runUserDeleted, runUserDisabled } from '../utils/user-lifecycle'
import type { upstream as upstreamTable } from '../db/schema'

type Who = { id: string, role: 'admin' | 'user' }
type DbUpstream = typeof upstreamTable.$inferSelect & { toolsEnabled?: number, toolsTotal?: number, secretNames?: string[] }

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const bad = (field: string, message: string) => apiError(422, 'validation', message, field)
const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

// ---------- Validierung ----------

type Checked = Omit<NewUpstream, 'slug' | 'type' | 'name'> & { name?: string }

function checkCommon(b: Record<string, unknown>, partial: boolean): Checked {
  const out: Checked = {}
  const str = (k: string, max: number) => {
    if (b[k] === undefined) return undefined
    if (typeof b[k] !== 'string') throw bad(k, `${k} muss ein Text sein`)
    const v = (b[k] as string).trim()
    if (v.length > max) throw bad(k, `${k} ist zu lang`)
    return v
  }
  const int = (k: string, min: number, max: number) => {
    if (b[k] === undefined) return undefined
    const v = b[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(k, `${k} muss eine ganze Zahl von ${min} bis ${max} sein`)
    return v
  }
  const name = str('name', 80)
  if (name !== undefined) { if (!name) throw bad('name', 'name darf nicht leer sein'); out.name = name }
  else if (!partial) throw bad('name', 'name fehlt')
  if (b.description !== undefined) out.description = b.description === null ? null : str('description', 500)
  const url = str('url', 2048)
  if (url !== undefined) {
    let u: URL
    try { u = new URL(url) } catch { throw bad('url', 'url ist keine gültige Adresse') }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw bad('url', 'url muss http(s) ohne Zugangsdaten sein')
    out.url = url
  }
  if (b.transport !== undefined) { if (!['auto', 'streamable', 'sse'].includes(b.transport as string)) throw bad('transport', 'transport ungültig'); out.transport = b.transport as string }
  if (b.authType !== undefined) { if (!['none', 'bearer', 'header', 'env'].includes(b.authType as string)) throw bad('authType', 'authType ungültig'); out.authType = b.authType as string }
  if (b.authHeaderName !== undefined) {
    if (b.authHeaderName !== null && !(typeof b.authHeaderName === 'string' && HEADER_RE.test(b.authHeaderName))) throw bad('authHeaderName', 'Headername ungültig')
    out.authHeaderName = b.authHeaderName as string | null
  }
  const rate = int('ratePerMin', 1, 100_000); if (rate !== undefined) out.ratePerMin = rate
  const conc = int('maxConcurrent', 1, 1000); if (conc !== undefined) out.maxConcurrent = conc
  if (b.timeouts !== undefined) {
    if (b.timeouts === null) out.timeouts = null
    else if (typeof b.timeouts === 'object' && !Array.isArray(b.timeouts)) {
      const t: Partial<Timeouts> = {}
      for (const k of ['connectMs', 'listMs', 'callMs'] as const) {
        const v = (b.timeouts as Record<string, unknown>)[k]
        if (v === undefined) continue
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 100 || v > 600_000) throw bad(`timeouts.${k}`, `${k} muss 100 bis 600000 sein`)
        t[k] = v
      }
      out.timeouts = t
    } else throw bad('timeouts', 'timeouts ungültig')
  }
  const command = str('command', 512); if (command !== undefined) { if (!command) throw bad('command', 'command darf nicht leer sein'); out.command = command }
  if (b.args !== undefined) {
    if (!Array.isArray(b.args) || b.args.length > 50 || b.args.some(a => typeof a !== 'string' || a.length > 1024)) throw bad('args', 'args muss eine Liste von höchstens 50 Texten sein')
    out.args = b.args as string[]
  }
  if (b.env !== undefined) {
    const e = b.env
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length > 50) throw bad('env', 'env ungültig')
    for (const [k, v] of Object.entries(e)) if (!ENV_RE.test(k) || typeof v !== 'string' || v.length > 4096) throw bad(`env.${k}`, 'env-Eintrag ungültig')
    out.env = e as Record<string, string>
  }
  if (b.cwd !== undefined) {
    if (b.cwd !== null) {
      const c = str('cwd', 256)!
      if (c.startsWith('/') || c.split('/').includes('..') || c.includes('\0')) throw bad('cwd', 'cwd muss relativ zum Nutzerverzeichnis sein (ohne ..)')
      out.cwd = c
    } else out.cwd = null
  }
  return out
}

// ---------- Mapping ----------

export function toSummary(rt: Runtime, r: DbUpstream): UpstreamSummary {
  const h = rt.gw.healthFor({ id: r.id, userId: r.userId, enabled: r.enabled, setup: r.setup as UpstreamSummary['setup'], status: r.status as UpstreamSummary['status'] } as never)
  const next = h.breaker.nextRetryAt
  return {
    id: r.id, slug: r.slug, name: r.name, description: r.description, type: r.type as UpstreamSummary['type'], url: r.url, command: r.command, enabled: r.enabled,
    status: r.status as UpstreamSummary['status'], statusReason: r.statusReason, statusChangedAt: iso(r.statusChangedAt), lastError: r.lastError, lastOkAt: iso(r.lastOkAt),
    setup: r.setup as UpstreamSummary['setup'], toolsEnabled: r.toolsEnabled ?? 0, toolsTotal: r.toolsTotal ?? 0,
    nextRetryAt: r.status === 'open' && next ? new Date(next).toISOString() : null,
    rateLimitHits5m: rt.gw.limiter.hitsLast5m(r.id), hasSecret: (r.secretNames?.length ?? 0) > 0,
  }
}

export function toDetail(rt: Runtime, r: DbUpstream): UpstreamDetail {
  const t = mergeTimeouts(r.timeouts as Partial<Timeouts> | null)
  return {
    ...toSummary(rt, r),
    transport: r.transport as UpstreamDetail['transport'], authType: r.authType as UpstreamDetail['authType'], authHeaderName: r.authHeaderName,
    ratePerMin: r.ratePerMin, maxConcurrent: r.maxConcurrent, timeouts: t, args: (r.args as string[]) ?? [], cwd: r.cwd, env: (r.env as Record<string, string>) ?? {},
    secretNames: r.secretNames ?? [], version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  }
}

const evict = async (rt: Runtime, userId: string, id: string) => {
  await rt.gw.pool.invalidate(userId, id)
  rt.gw.catalog.invalidate(userId, id)
  notifyToolsChanged(userId)
}
const rec = (rt: Runtime, who: Who, action: AuditAction, targetType: 'upstream' | 'secret' | 'tool', id: string, label: string | null, meta?: Record<string, unknown>) =>
  audit(rt.repo, { userId: who.id, actor: `user:${who.id}`, action, targetType, targetId: id, targetLabel: label, meta })

/** Frühe Rückmeldung (Komfort, nie Schutz): Literal-Adressen gegen die aktuelle Ausnahmeliste. */
async function precheckUrl(rt: Runtime, url: string | null | undefined) {
  if (!url) return
  try { assertUrlAllowed(url, await rt.allow()) } catch (e) {
    if (e instanceof SsrfBlockedError) throw apiError(422, 'ssrf_blocked', 'Dieses Ziel ist nicht erlaubt (SSRF-Schutz)', 'url')
    throw e
  }
}

async function requireStdio(rt: Runtime, who: Who) {
  const limits = await rt.repo.getLimits(who.id)
  const pol = await rt.stdioPolicyFor(who.role, limits.stdioAllowed)
  if (!pol.allowed) throw createError({ statusCode: 403, statusMessage: 'Forbidden', data: { code: 'stdio_not_allowed', message: 'stdio ist für dich nicht freigegeben', reason: pol.reason } })
}

async function load(rt: Runtime, who: Who, id: string): Promise<DbUpstream> {
  const r = await rt.repo.getUpstreamDetail(who.id, id)
  if (!r) throw apiError(404, 'not_found', 'Upstream nicht gefunden')
  return r
}

// ---------- Upstreams ----------

export async function listUpstreams(rt: Runtime, who: Who) {
  return { items: (await rt.repo.listUpstreams(who.id)).map(r => toSummary(rt, r)) }
}
export async function getUpstream(rt: Runtime, who: Who, id: string) {
  return toDetail(rt, await load(rt, who, id))
}

export async function createUpstream(rt: Runtime, who: Who, body: Record<string, unknown>): Promise<UpstreamDetail> {
  const slug = typeof body.slug === 'string' ? body.slug : ''
  if (!isValidSlug(slug)) throw bad('slug', 'slug muss ^[a-z0-9][a-z0-9-]{0,31}$ entsprechen')
  if (body.type !== 'http' && body.type !== 'stdio') throw bad('type', 'type muss http oder stdio sein')
  const c = checkCommon(body, false)
  if (body.type === 'http' && !c.url) throw bad('url', 'url fehlt')
  await precheckUrl(rt, c.url)
  if (body.type === 'stdio') { if (!c.command) throw bad('command', 'command fehlt'); await requireStdio(rt, who) }
  if ((c.authType ?? 'none') === 'header' && !c.authHeaderName) throw bad('authHeaderName', 'authHeaderName fehlt')
  if (body.type === 'stdio' && ['bearer', 'header'].includes(c.authType ?? '')) throw bad('authType', 'stdio kennt nur env')
  if (body.type === 'http' && c.authType === 'env') throw bad('authType', 'http kennt kein env')
  const limits = await rt.repo.getLimits(who.id)
  const setup = (c.authType ?? 'none') === 'none' ? 'ready' : 'awaiting_auth'
  try {
    const row = await rt.repo.createUpstream(who.id, { ...c, slug, type: body.type, name: c.name! }, setup, limits.maxUpstreams)
    await rec(rt, who, 'upstream.create', 'upstream', row.id, row.slug)
    notifyToolsChanged(who.id)
    return toDetail(rt, (await rt.repo.getUpstreamDetail(who.id, row.id))!)
  } catch (e) {
    if (e instanceof SlugTaken) throw apiError(409, 'slug_taken', 'Dieser Kurzname ist schon vergeben', 'slug')
    if (e instanceof LimitReached) throw apiError(409, 'limit_reached', 'Das Upstream-Limit ist erreicht')
    throw e
  }
}

export async function patchUpstream(rt: Runtime, who: Who, id: string, body: Record<string, unknown>): Promise<UpstreamDetail> {
  if (body.slug !== undefined || body.type !== undefined) throw apiError(422, 'slug_immutable', 'Kurzname und Typ sind nicht änderbar', body.slug !== undefined ? 'slug' : 'type')
  const cur = await load(rt, who, id)
  const c = checkCommon(body, true)
  await precheckUrl(rt, c.url)
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw bad('enabled', 'enabled muss boolean sein')
  if (cur.type === 'http' && (c.command !== undefined || c.args !== undefined || c.cwd !== undefined || c.env !== undefined)) throw bad('command', 'Feld gehört zu stdio')
  if (cur.type === 'stdio' && (c.url !== undefined || c.transport !== undefined)) throw bad('url', 'Feld gehört zu http')
  if (cur.type === 'stdio' && body.enabled === true) await requireStdio(rt, who)
  const authType = c.authType ?? cur.authType
  if (c.authType !== undefined && cur.type === 'stdio' && ['bearer', 'header'].includes(authType)) throw bad('authType', 'stdio kennt nur env')
  if (c.authType !== undefined && cur.type === 'http' && authType === 'env') throw bad('authType', 'http kennt kein env')
  if (authType === 'header' && !(c.authHeaderName ?? cur.authHeaderName)) throw bad('authHeaderName', 'authHeaderName fehlt')
  const patch: Parameters<typeof rt.repo.updateUpstream>[2] = { ...c, ...(body.enabled !== undefined ? { enabled: body.enabled as boolean } : {}) }
  const headerRenamed = authType === 'header' && c.authHeaderName !== undefined && c.authHeaderName !== cur.authHeaderName
  if ((c.authType !== undefined && c.authType !== cur.authType) || headerRenamed) {
    // Auth-Art oder Headername gewechselt: das alte Secret passt nicht mehr (es ist an Art und Namen gebunden und wuerde sonst still
    // ohne Header gesendet); der Nutzer traegt es neu ein
    for (const s of await rt.repo.getSecrets(who.id, id)) await rt.repo.deleteSecret(who.id, id, s.kind, s.name)
    patch.setup = authType === 'none' ? 'ready' : 'awaiting_auth'
  }
  const row = await rt.repo.updateUpstream(who.id, id, patch)
  if (!row) throw apiError(404, 'not_found', 'Upstream nicht gefunden')
  await evict(rt, who.id, id)
  const action: AuditAction = body.enabled === true && !cur.enabled ? 'upstream.enable' : body.enabled === false && cur.enabled ? 'upstream.disable' : 'upstream.update'
  await rec(rt, who, action, 'upstream', id, row.slug)
  const h = rt.gw.healthFor(toRowForHealth(row))
  h.configure({ enabled: row.enabled, setup: row.setup as 'ready' })
  return toDetail(rt, (await rt.repo.getUpstreamDetail(who.id, id))!)
}
const toRowForHealth = (r: DbUpstream) => ({ id: r.id, userId: r.userId, enabled: r.enabled, setup: r.setup, status: r.status }) as never

export async function deleteUpstream(rt: Runtime, who: Who, id: string) {
  const cur = await load(rt, who, id)
  await rt.gw.pool.invalidate(who.id, id)
  if (!(await rt.repo.deleteUpstream(who.id, id))) throw apiError(404, 'not_found', 'Upstream nicht gefunden')
  rt.gw.catalog.invalidate(who.id, id)
  notifyToolsChanged(who.id)
  await rec(rt, who, 'upstream.delete', 'upstream', id, cur.slug)
}

// ---------- Secrets ----------

export async function putSecret(rt: Runtime, who: Who, id: string, body: Record<string, unknown>) {
  const cur = await load(rt, who, id)
  const kind = body.kind
  if (kind !== 'bearer' && kind !== 'header' && kind !== 'env') throw bad('kind', 'kind ungültig')
  const value = body.value
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\r\n\0]/.test(value)) throw bad('value', 'value ungültig')
  if (kind !== cur.authType) throw bad('kind', `kind passt nicht zu authType ${cur.authType}`)
  let name = ''
  if (kind === 'header') name = cur.authHeaderName ?? ''
  if (kind === 'env') {
    name = typeof body.name === 'string' ? body.name : ''
    if (!ENV_RE.test(name)) throw bad('name', 'Name der Umgebungsvariable ungültig')
  }
  const ciphertext = encryptSecret(getMasterKey(), who.id, { upstreamId: id, kind, name }, value)
  await rt.repo.putSecret(who.id, id, { kind, name, ciphertext })
  const wasAwaiting = cur.setup === 'awaiting_auth'
  await rt.repo.updateUpstream(who.id, id, wasAwaiting ? { setup: 'ready' } : {})
  await evict(rt, who.id, id)
  rt.gw.healthFor(toRowForHealth(cur)).configure({ enabled: cur.enabled, setup: 'ready' })
  await rec(rt, who, 'secret.replace', 'secret', id, cur.slug)
  return { hasSecret: true as const, setup: 'ready' as const }
}

export async function deleteSecret(rt: Runtime, who: Who, id: string, kind: string, name: string) {
  const cur = await load(rt, who, id)
  if (!(await rt.repo.deleteSecret(who.id, id, kind, name))) throw apiError(404, 'not_found', 'Secret nicht gefunden')
  const left = await rt.repo.secretCount(who.id, id)
  await rt.repo.updateUpstream(who.id, id, left === 0 && cur.authType !== 'none' ? { setup: 'awaiting_auth' } : {})
  await evict(rt, who.id, id)
  await rec(rt, who, 'secret.delete', 'secret', id, cur.slug)
}

// ---------- Test und Tools ----------

export async function testUpstream(rt: Runtime, who: Who, id: string): Promise<UpstreamTestResult> {
  const cur = await load(rt, who, id)
  if (cur.setup !== 'ready') return { ok: false, errorCode: 'awaiting_auth', message: 'Zugangsdaten fehlen noch' }
  if (cur.type === 'stdio') {
    const limits = await rt.repo.getLimits(who.id)
    const pol = await rt.stdioPolicyFor(who.role, limits.stdioAllowed)
    if (!pol.allowed) return { ok: false, errorCode: 'stdio_not_allowed', message: 'stdio ist nicht freigegeben' }
  }
  const row = (await rt.repo.getUpstream(who.id, id))!
  const h = rt.gw.healthFor(row)
  const t0 = performance.now()
  try {
    rt.gw.catalog.invalidate(who.id, id)
    const r = await rt.gw.catalog.list(row, undefined, undefined, who.id)
    h.success()
    notifyToolsChanged(who.id)
    return { ok: true, tools: r.tools.map(t => ({ name: t.name, ...(t.description ? { description: t.description } : {}) })), latencyMs: Math.round(performance.now() - t0) }
  } catch (e) {
    const c = classifyError(e, { hasAuth: row.authType !== 'none' })
    if (c.auth) h.failure('auth'); else if (c.counts) h.failure(c.code === 'timeout' ? 'timeout' : c.status && c.status >= 500 ? 'http5xx' : 'connect')
    const code = c.code === 'cancelled' ? 'upstream_error' : c.code
    return { ok: false, errorCode: code, message: c.message, latencyMs: Math.round(performance.now() - t0) }
  }
}

export async function listUpstreamTools(rt: Runtime, who: Who, id: string): Promise<UpstreamToolList> {
  await load(rt, who, id)
  const rows = await rt.repo.listToolRows(who.id, id)
  const cached = rt.gw.catalog.cached((await rt.repo.getUpstream(who.id, id))!)
  const meta = new Map((cached?.tools ?? []).map(t => [t.name, t]))
  return {
    items: rows.map((r) => {
      const t = r.gone ? undefined : meta.get(r.name)
      const a = t?.annotations
      return {
        name: r.name, title: t?.title ?? null, description: t?.description ?? null, enabled: r.enabled, gone: r.gone,
        firstSeenAt: r.firstSeenAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(),
        ...(a ? { annotations: { readOnlyHint: a.readOnlyHint, destructiveHint: a.destructiveHint, idempotentHint: a.idempotentHint } } : {}),
      }
    }),
    fetchedAt: cached ? new Date(cached.fetchedAt).toISOString() : null,
    stale: !cached || !rt.gw.catalog.isFresh((await rt.repo.getUpstream(who.id, id))!),
  }
}

export async function setToolEnabled(rt: Runtime, who: Who, id: string, name: string, enabled: unknown) {
  if (typeof enabled !== 'boolean') throw bad('enabled', 'enabled muss boolean sein')
  const cur = await load(rt, who, id)
  const row = await rt.repo.setToolEnabled(who.id, id, name, enabled)
  if (!row) throw apiError(404, 'not_found', 'Tool nicht gefunden')
  notifyToolsChanged(who.id)
  await rec(rt, who, enabled ? 'tool.enable' : 'tool.disable', 'tool', id, `${cur.slug}__${name}`)
  const t = rt.gw.catalog.cached((await rt.repo.getUpstream(who.id, id))!)?.tools.find(x => x.name === name)
  return {
    name: row.name, title: t?.title ?? null, description: t?.description ?? null, enabled: row.enabled, gone: row.gone,
    firstSeenAt: row.firstSeenAt.toISOString(), lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

// ---------- Capabilities, Dashboard ----------

export async function capabilities(rt: Runtime, who: Who, baseUrl: URL): Promise<Capabilities> {
  const limits = await rt.repo.getLimits(who.id)
  const pol = await rt.stdioPolicyFor(who.role, limits.stdioAllowed)
  return {
    mcpUrl: new URL('/mcp', baseUrl).toString(), role: who.role,
    stdio: pol.allowed ? { allowed: true } : { allowed: false, reason: pol.reason },
    limits: { maxUpstreams: limits.maxUpstreams, upstreamsUsed: await rt.repo.countUpstreams(who.id), maxConnections: limits.maxConnections, callsPerMin: limits.callsPerMin },
    defaults: { ratePerMin: DEFAULT_LIMITS.ratePerMin, maxConcurrent: DEFAULT_LIMITS.maxConcurrent, timeouts: { connectMs: TIMEOUTS.connectMs, listMs: TIMEOUTS.listMs, callMs: TIMEOUTS.callMs } },
  }
}

export async function dashboard(rt: Runtime, who: Who, deps: { connections: Array<{ clientId: string, name: string, allowlisted: boolean, lastUsedAt: string | null }> }, now = new Date()): Promise<Dashboard> {
  const usage = await rt.repo.dashboardUsage(who.id, now)
  const pats = await rt.repo.patNames(who.id)
  const clients: Dashboard['clients'] = []
  const mk = (kind: 'oauth' | 'pat', id: string, name: string, allowlisted: boolean | null, key: string, lastUsed: Date | null) => {
    const u = usage.get(key)
    const last = u?.lastTs && (!lastUsed || u.lastTs > lastUsed) ? u.lastTs : lastUsed
    clients.push({
      kind, id, name, allowlisted, active: !!last && now.getTime() - last.getTime() < ACTIVE_WINDOW_MS, lastActiveAt: iso(last),
      callsPerMin: Math.round(((u?.calls5m ?? 0) / 5) * 100) / 100, contextTokensEstimate: u?.listBytes == null ? null : Math.round(u.listBytes / 4),
    })
  }
  for (const c of deps.connections) mk('oauth', c.clientId, c.name, c.allowlisted, c.clientId, c.lastUsedAt ? new Date(c.lastUsedAt) : null)
  for (const p of pats) mk('pat', p.id, p.name, null, `pat:${p.id}`, p.lastUsedAt)
  const att = await rt.repo.attention(who.id)
  const attention = att.map((r) => {
    const s = toSummary(rt, r)
    return { upstreamId: r.id, slug: r.slug, name: r.name, status: s.status, statusReason: s.statusReason, nextRetryAt: s.nextRetryAt }
  })
  return { clients, attention, attentionCount: attention.length }
}

// ---------- Audit ----------

export async function listAudit(rt: Runtime, who: Who, q: { category?: string, result?: string, from?: string, to?: string, cursor?: string, limit?: string }) {
  const limit = Math.min(Math.max(Number(q.limit ?? 50) || 50, 1), 200)
  const cats = ['management', 'auth', 'status', 'denied']
  const results = ['success', 'denied', 'pending', 'status_change']
  if (q.category && !cats.includes(q.category)) throw bad('category', 'category ungültig')
  if (q.result && !results.includes(q.result)) throw bad('result', 'result ungültig')
  const date = (k: 'from' | 'to') => { if (!q[k]) return undefined; const d = new Date(q[k]!); if (Number.isNaN(d.getTime())) throw bad(k, `${k} ungültig`); return d }
  const cursor = q.cursor === undefined ? undefined : Number(q.cursor)
  if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 1)) throw bad('cursor', 'cursor ungültig')
  const rows = await rt.repo.listAudit({ id: who.id, isAdmin: who.role === 'admin' }, { category: q.category, result: q.result, from: date('from'), to: date('to'), cursor, limit })
  const page = rows.slice(0, limit)
  const items: AuditItem[] = page.map(r => ({
    id: r.id, ts: r.ts.toISOString(), actorKind: r.actor.startsWith('admin:') ? 'admin' : r.actor.startsWith('user:') ? 'user' : 'system',
    actorIsSelf: r.actor.endsWith(`:${who.id}`), clientId: r.clientId, clientName: null, action: r.action, category: r.category as AuditItem['category'],
    scope: r.scope as AuditItem['scope'], targetType: r.targetType, targetId: r.targetId, targetLabel: r.targetLabel, result: r.result as AuditItem['result'],
  }))
  return { items, nextCursor: rows.length > limit ? String(page.at(-1)!.id) : null }
}

// ---------- Admin ----------

const limitsOf = (l: { maxUpstreams?: number, callsPerMin?: number, maxConnections?: number, stdioMaxProcs?: number, stdioIdleMin?: number } | null): UserLimits => ({
  maxUpstreams: l?.maxUpstreams ?? DEFAULT_LIMITS.maxUpstreams, callsPerMin: l?.callsPerMin ?? DEFAULT_LIMITS.callsPerMin, maxConnections: l?.maxConnections ?? DEFAULT_LIMITS.maxConnections,
  stdioMaxProcs: l?.stdioMaxProcs ?? DEFAULT_LIMITS.stdioMaxProcs, stdioIdleMin: l?.stdioIdleMin ?? DEFAULT_LIMITS.stdioIdleMin,
})
const adminUserOf = (x: Awaited<ReturnType<Runtime['repo']['listUsers']>>[number]): AdminUser => ({
  id: x.u.id, email: x.u.email, name: x.u.name, role: x.u.role === 'admin' ? 'admin' : 'user', banned: !!x.u.banned, banReason: x.u.banReason ?? null,
  createdAt: x.u.createdAt.toISOString(), upstreamCount: x.upstreamCount, lastActivityAt: iso(x.lastActivityAt), stdioAllowed: x.limits?.stdioAllowed ?? false, limits: limitsOf(x.limits),
})

export async function adminListUsers(rt: Runtime): Promise<AdminUserList> {
  return { items: (await rt.repo.listUsers()).map(adminUserOf), defaults: limitsOf(null) }
}

export async function adminSetLimits(rt: Runtime, admin: Who, targetId: string, body: Record<string, unknown>): Promise<AdminUser> {
  const set: AdminUserLimitsInput = {}
  for (const k of ['maxUpstreams', 'callsPerMin', 'maxConnections', 'stdioMaxProcs', 'stdioIdleMin'] as const) {
    if (body[k] === undefined) continue
    const v = body[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1_000_000) throw bad(k, `${k} muss eine ganze Zahl ≥ 1 sein`)
    set[k] = v
  }
  if (body.stdioAllowed !== undefined) { if (typeof body.stdioAllowed !== 'boolean') throw bad('stdioAllowed', 'stdioAllowed muss boolean sein'); set.stdioAllowed = body.stdioAllowed }
  if (!Object.keys(set).length) throw bad('limits', 'keine Änderung angegeben')
  if (!(await rt.repo.getUserLite(targetId))) throw apiError(404, 'not_found', 'Nutzer nicht gefunden')
  const before = await rt.repo.getLimits(targetId)
  await rt.repo.setLimits(targetId, set)
  rt.gw.limiter.forgetUser(targetId) // neue Kontingente gelten sofort
  if (set.stdioAllowed === false && before.stdioAllowed) await runUserDisabled(targetId) // Entzug stoppt den Worker
  await audit(rt.repo, { userId: targetId, actor: `admin:${admin.id}`, action: 'user.limits', targetType: 'limits', targetId, meta: { ...set } })
  return adminUserOf((await rt.repo.listUsers()).find(x => x.u.id === targetId)!)
}

export type AuthAdminApi = {
  banUser: (o: { userId: string, banReason?: string }) => Promise<unknown>
  unbanUser: (o: { userId: string }) => Promise<unknown>
  removeUser: (o: { userId: string }) => Promise<unknown>
}

/**
 * Admin-Aktionen mit Rechteverlust laufen nacheinander: sonst sperren sich zwei Admins gleichzeitig gegenseitig aus (Prüfung und Aktion sind sonst getrennt).
 * Dazu gehört auch die Anmeldung des Aufrufers: Sperren widerruft dessen Sitzungen. Wer gleichzeitig angekommen ist, muss deshalb noch als der Admin gelten,
 * der er bei Ankunft war (und dann `last_admin` bekommen), statt vom Sieger per 401 aus der Sitzung geworfen zu werden. Die Handler melden ihre Anmeldung
 * mit `admitAdminAction` an, bevor sie etwas anderes awaiten; jede Aktion wartet, bevor sie etwas ändert, auf alle bis dahin angekommenen Anmeldungen.
 */
let adminTail: Promise<unknown> = Promise.resolve()
const admitting = new Set<Promise<unknown>>()
export function admitAdminAction<T>(auth: Promise<T>): Promise<T> {
  const settled = auth.then(() => {}, () => {})
  admitting.add(settled)
  void settled.then(() => admitting.delete(settled))
  return auth
}
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = adminTail.then(() => Promise.all([...admitting])).then(fn)
  adminTail = run.catch(() => {})
  return run
}

async function guardTarget(rt: Runtime, admin: Who, targetId: string, op: 'ban' | 'delete') {
  const t = await rt.repo.getUserLite(targetId)
  if (!t) throw apiError(404, 'not_found', 'Nutzer nicht gefunden')
  if (t.id === admin.id) throw apiError(409, 'self_target', 'Das eigene Konto kann nicht gesperrt oder gelöscht werden')
  if (t.role === 'admin' && !t.banned && (await rt.repo.activeAdminCount(t.id)) === 0) throw apiError(409, 'last_admin', `Der letzte aktive Admin kann nicht ${op === 'ban' ? 'gesperrt' : 'gelöscht'} werden`)
  return t
}

export async function adminBan(rt: Runtime, admin: Who, api: AuthAdminApi, targetId: string, reason?: unknown) {
  const banReason = typeof reason === 'string' ? reason.slice(0, 200) : undefined
  await serialized(async () => {
    await guardTarget(rt, admin, targetId, 'ban')
    await api.banUser({ userId: targetId, banReason })
  })
  await runUserBanned(targetId)
  await closeUserStreams(targetId)
  await audit(rt.repo, { userId: targetId, actor: `admin:${admin.id}`, action: 'user.ban', targetType: 'user', targetId })
}
export async function adminUnban(rt: Runtime, admin: Who, api: AuthAdminApi, targetId: string) {
  if (!(await rt.repo.getUserLite(targetId))) throw apiError(404, 'not_found', 'Nutzer nicht gefunden')
  await api.unbanUser({ userId: targetId })
  await audit(rt.repo, { userId: targetId, actor: `admin:${admin.id}`, action: 'user.unban', targetType: 'user', targetId })
}
export async function adminDelete(rt: Runtime, admin: Who, api: AuthAdminApi, targetId: string) {
  await serialized(async () => {
    await guardTarget(rt, admin, targetId, 'delete')
    await runUserBanned(targetId)
    await closeUserStreams(targetId)
    await api.removeUser({ userId: targetId })
  })
  await runUserDeleted(targetId)
  await audit(rt.repo, { userId: targetId, actor: `admin:${admin.id}`, action: 'user.delete', targetType: 'user', targetId })
}

export async function adminListInvites(rt: Runtime): Promise<{ items: InviteSummary[] }> {
  const now = new Date()
  return {
    items: (await rt.repo.listInvites()).map(r => ({
      id: r.id, email: r.email, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), status: rt.repo.inviteStatus(r, now),
      usedAt: iso(r.usedAt), usedByUserId: r.usedBy, createdByUserId: r.createdBy,
    })),
  }
}
export async function adminCreateInvite(rt: Runtime, admin: Who, baseUrl: URL, email: unknown, opts: { sendMail?: unknown, mailer?: Mailer } = {}) {
  let mail: string | null = null
  if (email !== undefined && email !== null && email !== '') {
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('email', 'E-Mail-Adresse ungültig')
    mail = email.toLowerCase()
  }
  const wantMail = opts.sendMail === true
  if (opts.sendMail !== undefined && typeof opts.sendMail !== 'boolean') throw bad('sendMail', 'sendMail muss true oder false sein')
  if (wantMail && !mail) throw bad('sendMail', 'Für den Versand per E-Mail ist eine E-Mail-Adresse nötig')
  if (wantMail && !opts.mailer?.enabled) throw bad('sendMail', 'E-Mail-Versand ist nicht eingerichtet')
  const { token, row } = await rt.repo.createInvite(admin.id, mail)
  await audit(rt.repo, { userId: null, actor: `admin:${admin.id}`, action: 'invite.create', targetType: 'invite', targetId: row.id })
  const link = new URL(`/invite/${token}`, baseUrl).toString()
  // Fire-and-forget: Versandfehler (auch Empfaengerlimit) brechen das Anlegen nie ab; der Admin sieht den Link weiterhin.
  if (wantMail && mail) void trySendMail(opts.mailer!, inviteMail(mail, link), 'Einladung')
  return { id: row.id, email: row.email, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), link, mailQueued: wantMail }
}
export async function adminRevokeInvite(rt: Runtime, admin: Who, id: string) {
  if (!UUID_RE.test(id)) throw apiError(404, 'not_found', 'Einladung nicht gefunden') // sonst wirft Postgres "invalid input syntax for uuid" (500)
  if (!(await rt.repo.revokeInvite(id))) throw apiError(409, 'invite_not_open', 'Die Einladung ist nicht mehr offen')
  await audit(rt.repo, { userId: null, actor: `admin:${admin.id}`, action: 'invite.revoke', targetType: 'invite', targetId: id })
}
export async function inviteInfo(rt: Runtime, token: string) {
  const inv = token.length >= 20 && token.length <= 100 ? await rt.repo.inviteByToken(token) : null
  if (!inv) return { valid: false as const, reason: 'unknown' as const }
  const st = rt.repo.inviteStatus(inv)
  return st === 'open' ? { valid: true as const, email: inv.email, expiresAt: inv.expiresAt.toISOString() } : { valid: false as const, reason: st }
}

// ---------- Einstellungen ----------

const METADATA_IPS = ['169.254.169.254', '100.100.100.200', 'fd00:ec2::254', '192.0.0.192']
function warningsFor(entries: string[]): AdminSettingsResult['warnings'] {
  const w: AdminSettingsResult['warnings'] = []
  for (const entry of entries) {
    const list = new AllowList([entry])
    if (METADATA_IPS.some(ip => list.allowsAddress(ip))) w.push({ key: 'ssrf.allow', entry, code: 'covers_metadata_ip' })
  }
  return w
}
export async function getSettings(rt: Runtime): Promise<AdminSettingsResult> {
  const allow = await rt.repo.getSetting<string[]>('ssrf.allow', [])
  return { 'stdio.enabled': await rt.repo.getSetting<boolean>('stdio.enabled', false), 'ssrf.allow': allow, warnings: warningsFor(allow) }
}
export async function putSettings(rt: Runtime, admin: Who, body: Record<string, unknown>): Promise<AdminSettingsResult> {
  const patch: Partial<AdminSettings> = {}
  if (body['stdio.enabled'] !== undefined) {
    if (typeof body['stdio.enabled'] !== 'boolean') throw bad('stdio.enabled', 'muss boolean sein')
    patch['stdio.enabled'] = body['stdio.enabled']
  }
  if (body['ssrf.allow'] !== undefined) {
    const a = body['ssrf.allow']
    if (!Array.isArray(a) || a.length > 100) throw bad('ssrf.allow', 'muss eine Liste mit höchstens 100 Einträgen sein')
    const norm: string[] = []
    a.forEach((e, i) => {
      const err = typeof e === 'string' ? validateAllowEntry(e) : 'kein Text'
      if (err) throw bad(`ssrf.allow[${i}]`, err)
      norm.push((e as string).trim().toLowerCase())
    })
    patch['ssrf.allow'] = [...new Set(norm)]
  }
  for (const [k, v] of Object.entries(patch)) {
    await rt.repo.setSetting(k, v)
    await audit(rt.repo, { userId: null, actor: `admin:${admin.id}`, action: 'setting.change', targetType: 'setting', targetId: k, meta: { key: k } })
  }
  rt.invalidateSettings()
  if (patch['stdio.enabled'] === false) for (const u of await rt.repo.listUsers()) await rt.gw.onUserDisabled(u.u.id)
  return await getSettings(rt)
}
