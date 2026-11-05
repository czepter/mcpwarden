/**
 * Alle DB-Zugriffe der Gateway-Funktionen. Jede nutzerbezogene Funktion nimmt `userId` als ersten Parameter und
 * filtert darauf; Zugriff per ID allein gibt es nicht (fremde Datensätze sind "nicht gefunden").
 */
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, max, notInArray, or, sql } from 'drizzle-orm'
import type { Db } from '../../db'
import { appSetting, auditLog, callStat, personalAccessToken, upstream, upstreamSecret, upstreamTool, user, userGatewayLimits, userInvite, userPreference } from '../../db/schema'
import { ACTIVE_WINDOW_MS, DEFAULT_LIMITS, INVITE_TTL_DAYS } from '../config'
import type { Timeouts } from '../config'
import type { CallStatRow } from '../stats/buffer'
import type { StatusSnapshot } from './status'
import type { GatewayStore, SecretRow, UpstreamRow, UserLimits } from './types'
import { auditMeta, type AuditEntry } from '../../utils/audit'

type UpstreamDb = typeof upstream.$inferSelect

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

export function toRow(r: UpstreamDb): UpstreamRow {
  return {
    id: r.id, userId: r.userId, slug: r.slug, name: r.name, type: r.type as UpstreamRow['type'], enabled: r.enabled, version: r.version,
    url: r.url, transport: r.transport as UpstreamRow['transport'], authType: r.authType as UpstreamRow['authType'], authHeaderName: r.authHeaderName,
    command: r.command, args: (r.args as string[]) ?? [], env: (r.env as Record<string, string>) ?? {}, cwd: r.cwd,
    ratePerMin: r.ratePerMin, maxConcurrent: r.maxConcurrent, timeouts: (r.timeouts as Partial<Timeouts> | null) ?? null,
    status: r.status as UpstreamRow['status'], setup: r.setup as UpstreamRow['setup'],
  }
}

export type NewUpstream = {
  slug: string, name: string, type: 'http' | 'stdio', description?: string | null, url?: string | null, transport?: string, authType?: string,
  authHeaderName?: string | null, ratePerMin?: number, maxConcurrent?: number, timeouts?: Partial<Timeouts> | null,
  command?: string | null, args?: string[], env?: Record<string, string>, cwd?: string | null,
}

export class SlugTaken extends Error {}
export class LimitReached extends Error {}

export class GatewayRepo implements GatewayStore {
  constructor(readonly db: Db) {}

  // --- GatewayStore (Laufzeitpfad) ---
  async listEnabledUpstreams(userId: string) {
    return (await this.db.select().from(upstream).where(and(eq(upstream.userId, userId), eq(upstream.enabled, true)))).map(toRow)
  }
  async getUpstreamBySlug(userId: string, slug: string) {
    const [r] = await this.db.select().from(upstream).where(and(eq(upstream.userId, userId), eq(upstream.slug, slug)))
    return r ? toRow(r) : null
  }
  async getUpstream(userId: string, id: string) {
    const [r] = await this.db.select().from(upstream).where(and(eq(upstream.userId, userId), eq(upstream.id, id)))
    return r ? toRow(r) : null
  }
  async getSecrets(userId: string, upstreamId: string): Promise<SecretRow[]> {
    const rows = await this.db.select().from(upstreamSecret).where(and(eq(upstreamSecret.userId, userId), eq(upstreamSecret.upstreamId, upstreamId)))
    return rows.map(r => ({ upstreamId: r.upstreamId, kind: r.kind as SecretRow['kind'], name: r.name, ciphertext: r.ciphertext }))
  }
  async getLimits(userId: string): Promise<UserLimits> {
    const [r] = await this.db.select().from(userGatewayLimits).where(eq(userGatewayLimits.userId, userId))
    return {
      maxUpstreams: r?.maxUpstreams ?? DEFAULT_LIMITS.maxUpstreams, callsPerMin: r?.callsPerMin ?? DEFAULT_LIMITS.callsPerMin,
      maxConnections: r?.maxConnections ?? DEFAULT_LIMITS.maxConnections, stdioAllowed: r?.stdioAllowed ?? false,
      stdioMaxProcs: r?.stdioMaxProcs ?? DEFAULT_LIMITS.stdioMaxProcs, stdioIdleMin: r?.stdioIdleMin ?? DEFAULT_LIMITS.stdioIdleMin,
    }
  }
  /** Default true (Zeile fehlt). */
  async getNotifyStatusMail(userId: string): Promise<boolean> {
    const [r] = await this.db.select({ v: userPreference.notifyStatusMail }).from(userPreference).where(eq(userPreference.userId, userId))
    return r?.v ?? true
  }
  async setNotifyStatusMail(userId: string, value: boolean) {
    await this.db.insert(userPreference).values({ userId, notifyStatusMail: value }).onConflictDoUpdate({ target: userPreference.userId, set: { notifyStatusMail: value, updatedAt: new Date() } })
  }
  async syncTools(userId: string, upstreamId: string, names: string[]) {
    const now = new Date()
    if (names.length) {
      await this.db.insert(upstreamTool).values(names.map(name => ({ upstreamId, name, userId, lastSeenAt: now })))
        .onConflictDoUpdate({ target: [upstreamTool.upstreamId, upstreamTool.name], set: { lastSeenAt: now, gone: false } })
    }
    const own = and(eq(upstreamTool.userId, userId), eq(upstreamTool.upstreamId, upstreamId))
    await this.db.update(upstreamTool).set({ gone: true }).where(names.length ? and(own, notInArray(upstreamTool.name, names)) : own)
    return this.toolFlags(userId, upstreamId)
  }
  async toolFlags(userId: string, upstreamId: string) {
    const rows = await this.db.select({ name: upstreamTool.name, enabled: upstreamTool.enabled }).from(upstreamTool)
      .where(and(eq(upstreamTool.userId, userId), eq(upstreamTool.upstreamId, upstreamId), eq(upstreamTool.gone, false)))
    return new Map(rows.map(r => [r.name, r.enabled]))
  }

  // --- Upstream-Verwaltung ---
  async countUpstreams(userId: string) {
    const [r] = await this.db.select({ n: count() }).from(upstream).where(eq(upstream.userId, userId))
    return r?.n ?? 0
  }
  async listUpstreams(userId: string): Promise<Array<UpstreamDb & { toolsEnabled: number, toolsTotal: number, secretNames: string[] }>> {
    const rows = await this.db.select().from(upstream).where(eq(upstream.userId, userId)).orderBy(asc(upstream.name))
    const tools = await this.db.select({ upstreamId: upstreamTool.upstreamId, enabled: upstreamTool.enabled }).from(upstreamTool).where(and(eq(upstreamTool.userId, userId), eq(upstreamTool.gone, false)))
    const secrets = await this.db.select({ upstreamId: upstreamSecret.upstreamId, kind: upstreamSecret.kind, name: upstreamSecret.name }).from(upstreamSecret).where(eq(upstreamSecret.userId, userId))
    return rows.map(r => ({
      ...r,
      toolsTotal: tools.filter(t => t.upstreamId === r.id).length,
      toolsEnabled: tools.filter(t => t.upstreamId === r.id && t.enabled).length,
      secretNames: secrets.filter(s => s.upstreamId === r.id).map(s => (s.kind === 'bearer' ? 'bearer' : s.name)),
    }))
  }
  async getUpstreamDetail(userId: string, id: string) {
    return (await this.listUpstreams(userId)).find(u => u.id === id) ?? null
  }

  /** Legt an; `limit` wird in derselben Transaktion gegen die Anzahl geprüft (kein Überschreiten durch Rennen). */
  async createUpstream(userId: string, p: NewUpstream, setup: 'ready' | 'awaiting_auth', maxUpstreams: number): Promise<UpstreamDb> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'upstream-create:' + userId}))`)
      const [n] = await tx.select({ n: count() }).from(upstream).where(eq(upstream.userId, userId))
      if ((n?.n ?? 0) >= maxUpstreams) throw new LimitReached()
      const [dup] = await tx.select({ id: upstream.id }).from(upstream).where(and(eq(upstream.userId, userId), eq(upstream.slug, p.slug)))
      if (dup) throw new SlugTaken()
      const [r] = await tx.insert(upstream).values({
        userId, slug: p.slug, name: p.name, description: p.description ?? null, type: p.type, url: p.url ?? null, transport: p.transport ?? 'auto',
        authType: p.authType ?? 'none', authHeaderName: p.authHeaderName ?? null, command: p.command ?? null, args: p.args ?? [], env: p.env ?? {},
        cwd: p.cwd ?? null, ratePerMin: p.ratePerMin ?? DEFAULT_LIMITS.ratePerMin, maxConcurrent: p.maxConcurrent ?? DEFAULT_LIMITS.maxConcurrent,
        timeouts: p.timeouts ?? null, setup, status: 'unknown',
      }).returning()
      return r!
    })
  }
  async updateUpstream(userId: string, id: string, patch: Partial<NewUpstream> & { enabled?: boolean, setup?: string }): Promise<UpstreamDb | null> {
    const { slug: _slug, type: _type, ...rest } = patch
    const set: Record<string, unknown> = { ...rest, updatedAt: new Date(), version: sql`${upstream.version} + 1` }
    for (const k of Object.keys(set)) if (set[k] === undefined) Reflect.deleteProperty(set, k)
    if (patch.enabled === false) { set.status = 'disabled'; set.statusReason = 'Upstream ist deaktiviert' }
    const [r] = await this.db.update(upstream).set(set).where(and(eq(upstream.userId, userId), eq(upstream.id, id))).returning()
    return r ?? null
  }
  async deleteUpstream(userId: string, id: string) {
    const r = await this.db.delete(upstream).where(and(eq(upstream.userId, userId), eq(upstream.id, id))).returning({ id: upstream.id })
    return r.length > 0
  }

  async putSecret(userId: string, upstreamId: string, s: { kind: string, name: string, ciphertext: string }) {
    await this.db.insert(upstreamSecret).values({ userId, upstreamId, kind: s.kind, name: s.name, ciphertext: s.ciphertext })
      .onConflictDoUpdate({ target: [upstreamSecret.upstreamId, upstreamSecret.kind, upstreamSecret.name], set: { ciphertext: s.ciphertext, updatedAt: new Date() } })
  }
  async deleteSecret(userId: string, upstreamId: string, kind: string, name: string) {
    const r = await this.db.delete(upstreamSecret).where(and(eq(upstreamSecret.userId, userId), eq(upstreamSecret.upstreamId, upstreamId), eq(upstreamSecret.kind, kind), eq(upstreamSecret.name, name))).returning({ id: upstreamSecret.id })
    return r.length > 0
  }
  async secretCount(userId: string, upstreamId: string) {
    const [r] = await this.db.select({ n: count() }).from(upstreamSecret).where(and(eq(upstreamSecret.userId, userId), eq(upstreamSecret.upstreamId, upstreamId)))
    return r?.n ?? 0
  }

  async listToolRows(userId: string, upstreamId: string) {
    return await this.db.select().from(upstreamTool).where(and(eq(upstreamTool.userId, userId), eq(upstreamTool.upstreamId, upstreamId))).orderBy(asc(upstreamTool.name))
  }
  async setToolEnabled(userId: string, upstreamId: string, name: string, enabled: boolean) {
    const [r] = await this.db.update(upstreamTool).set({ enabled }).where(and(eq(upstreamTool.userId, userId), eq(upstreamTool.upstreamId, upstreamId), eq(upstreamTool.name, name), eq(upstreamTool.gone, false))).returning()
    return r ?? null
  }

  /** Statuswechsel (nur bei Wechsel aufgerufen). */
  async persistStatus(userId: string, upstreamId: string, s: StatusSnapshot, err?: string | null) {
    await this.db.update(upstream).set({
      status: s.status, statusReason: s.reason, statusChangedAt: new Date(),
      ...(s.status === 'healthy' ? { lastOkAt: new Date(), lastError: null } : {}),
      ...(err ? { lastError: err.slice(0, 500) } : {}),
    }).where(and(eq(upstream.userId, userId), eq(upstream.id, upstreamId)))
  }

  // --- Limits ---
  async setLimits(userId: string, l: Partial<UserLimits & { stdioAllowed: boolean }>) {
    const set = { ...l, updatedAt: new Date() }
    await this.db.insert(userGatewayLimits).values({ userId, ...set }).onConflictDoUpdate({ target: userGatewayLimits.userId, set })
  }

  // --- Einstellungen (app_setting) ---
  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const [r] = await this.db.select().from(appSetting).where(eq(appSetting.key, key))
    return r ? r.value as T : fallback
  }
  async setSetting(key: string, value: unknown) {
    await this.db.insert(appSetting).values({ key, value }).onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } })
  }

  // --- Einladungen ---
  async createInvite(createdBy: string, email: string | null, now = new Date()) {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000)
    const [r] = await this.db.insert(userInvite).values({ tokenHash: sha256(token), email: email?.toLowerCase() ?? null, createdBy, createdAt: now, expiresAt }).returning()
    return { token, row: r! }
  }
  inviteStatus(r: typeof userInvite.$inferSelect, now = new Date()): 'open' | 'used' | 'expired' | 'revoked' {
    if (r.usedAt) return 'used'
    if (r.revokedAt) return 'revoked'
    if (r.expiresAt <= now) return 'expired'
    return 'open'
  }
  async listInvites() {
    return await this.db.select().from(userInvite).orderBy(desc(userInvite.createdAt)).limit(500)
  }
  async revokeInvite(id: string, now = new Date()) {
    const r = await this.db.update(userInvite).set({ revokedAt: now }).where(and(eq(userInvite.id, id), isNull(userInvite.usedAt), isNull(userInvite.revokedAt), gt(userInvite.expiresAt, now))).returning({ id: userInvite.id })
    return r.length > 0
  }
  async inviteByToken(token: string) {
    const [r] = await this.db.select().from(userInvite).where(eq(userInvite.tokenHash, sha256(token)))
    return r ?? null
  }
  /** Atomar: genau ein Aufrufer gewinnt (bedingtes UPDATE, Rennen entscheidet die Datenbank). */
  async claimInvite(token: string, email: string, now = new Date()) {
    const e = email.toLowerCase()
    const r = await this.db.update(userInvite).set({ usedAt: now }).where(and(
      eq(userInvite.tokenHash, sha256(token)), isNull(userInvite.usedAt), isNull(userInvite.revokedAt), gt(userInvite.expiresAt, now),
      or(isNull(userInvite.email), eq(userInvite.email, e)),
    )).returning({ id: userInvite.id })
    return r[0]?.id ?? null
  }
  async setInviteUsedBy(inviteId: string, userId: string) {
    await this.db.update(userInvite).set({ usedBy: userId }).where(eq(userInvite.id, inviteId))
  }
  /** Gibt eine beanspruchte Einladung frei, wenn das Anlegen des Nutzers danach scheiterte. */
  async releaseInvite(inviteId: string) {
    await this.db.update(userInvite).set({ usedAt: null }).where(and(eq(userInvite.id, inviteId), isNull(userInvite.usedBy)))
  }

  // --- Nutzer (Admin) ---
  async listUsers() {
    const users = await this.db.select().from(user).orderBy(asc(user.createdAt))
    const ups = await this.db.select({ userId: upstream.userId, n: count() }).from(upstream).groupBy(upstream.userId)
    const act = await this.db.select({ userId: callStat.userId, ts: max(callStat.ts) }).from(callStat).groupBy(callStat.userId)
    const lims = await this.db.select().from(userGatewayLimits)
    return users.map(u => ({
      u, upstreamCount: ups.find(x => x.userId === u.id)?.n ?? 0, lastActivityAt: act.find(x => x.userId === u.id)?.ts ?? null, limits: lims.find(x => x.userId === u.id) ?? null,
    }))
  }
  async activeAdminCount(exceptUserId?: string) {
    const rows = await this.db.select({ id: user.id }).from(user).where(and(eq(user.role, 'admin'), or(isNull(user.banned), eq(user.banned, false))))
    return rows.filter(r => r.id !== exceptUserId).length
  }
  async getUserLite(id: string) {
    const [r] = await this.db.select({ id: user.id, role: user.role, banned: user.banned, email: user.email }).from(user).where(eq(user.id, id))
    return r ?? null
  }

  // --- Audit ---
  async audit(e: AuditEntry & { scope: 'user' | 'instance', category: string, result: string }) {
    await this.db.insert(auditLog).values({
      userId: e.userId ?? null, actor: e.actor, clientId: e.clientId ?? null, action: e.action, targetType: e.targetType, targetId: e.targetId ?? null,
      targetLabel: e.targetLabel ?? null, scope: e.scope, category: e.category, result: e.result, meta: auditMeta(e.meta),
    })
  }
  async listAudit(viewer: { id: string, isAdmin: boolean }, q: { category?: string, result?: string, from?: Date, to?: Date, cursor?: number, limit: number }) {
    const visible = viewer.isAdmin
      ? or(and(eq(auditLog.scope, 'user'), eq(auditLog.userId, viewer.id)), eq(auditLog.scope, 'instance'))
      : and(eq(auditLog.scope, 'user'), eq(auditLog.userId, viewer.id))
    const conds = [visible!]
    if (q.category) conds.push(eq(auditLog.category, q.category))
    if (q.result) conds.push(eq(auditLog.result, q.result))
    if (q.from) conds.push(sql`${auditLog.ts} >= ${q.from}`)
    if (q.to) conds.push(sql`${auditLog.ts} <= ${q.to}`)
    if (q.cursor) conds.push(lt(auditLog.id, q.cursor))
    return await this.db.select().from(auditLog).where(and(...conds)).orderBy(desc(auditLog.id)).limit(q.limit + 1)
  }

  // --- Messdaten ---
  async writeStats(rows: CallStatRow[]) {
    if (!rows.length) return
    // Upstreams, die inzwischen gelöscht wurden: Messwert behalten (Slug steht in der Zeile), Verweis auf null setzen
    const ids = [...new Set(rows.map(r => r.upstreamId).filter((x): x is string => !!x))]
    const alive = new Set(ids.length ? (await this.db.select({ id: upstream.id }).from(upstream).where(inArray(upstream.id, ids))).map(r => r.id) : [])
    rows = rows.map(r => (r.upstreamId && !alive.has(r.upstreamId) ? { ...r, upstreamId: null } : r))
    await this.db.insert(callStat).values(rows.map(r => ({
      ts: r.ts, userId: r.userId, clientId: r.clientId, tokenId: r.tokenId, upstreamId: r.upstreamId, upstreamSlug: r.upstreamSlug, tool: r.tool, kind: r.kind,
      status: r.status, totalMs: r.totalMs, upstreamMs: r.upstreamMs, overheadMs: r.overheadMs, retries: r.retries, reqBytes: r.reqBytes, resBytes: r.resBytes, cacheHit: r.cacheHit,
    })))
  }
  async purgeStats(retentionDays: number, now = new Date()) {
    const r = await this.db.delete(callStat).where(lt(callStat.ts, new Date(now.getTime() - retentionDays * 86_400_000))).returning({ id: callStat.id })
    return r.length
  }

  // --- Dashboard ---
  async dashboardUsage(userId: string, now = new Date()) {
    const since5 = new Date(now.getTime() - ACTIVE_WINDOW_MS)
    const rows = await this.db.select({ clientId: callStat.clientId, tokenId: callStat.tokenId, kind: callStat.kind, ts: callStat.ts, resBytes: callStat.resBytes }).from(callStat)
      .where(and(eq(callStat.userId, userId), gt(callStat.ts, new Date(now.getTime() - 24 * 3_600_000)))).orderBy(desc(callStat.ts)).limit(5000)
    const byKey = new Map<string, { calls5m: number, lastTs: Date | null, listBytes: number | null }>()
    for (const r of rows) {
      const k = r.clientId ?? `pat:${r.tokenId ?? ''}`
      const e = byKey.get(k) ?? { calls5m: 0, lastTs: null, listBytes: null }
      if (!e.lastTs) e.lastTs = r.ts
      if (r.kind === 'call' && r.ts > since5) e.calls5m++
      if (r.kind === 'list' && e.listBytes === null) e.listBytes = r.resBytes
      byKey.set(k, e)
    }
    return byKey
  }
  async attention(userId: string) {
    return await this.db.select().from(upstream).where(and(eq(upstream.userId, userId), or(inArray(upstream.status, ['degraded', 'open', 'auth_expired']), inArray(upstream.setup, ['awaiting_auth', 'awaiting_approval'])))).orderBy(asc(upstream.name))
  }
  async patNames(userId: string) {
    return await this.db.select({ id: personalAccessToken.id, name: personalAccessToken.name, lastUsedAt: personalAccessToken.lastUsedAt }).from(personalAccessToken).where(and(eq(personalAccessToken.userId, userId), isNull(personalAccessToken.revokedAt)))
  }
}
