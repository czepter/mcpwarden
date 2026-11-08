/**
 * All DB access of the gateway functions. Every user-related function takes `userId` as its first parameter and
 * filters on it; there is no access by ID alone (foreign records are "not found").
 */
import { createHash, randomBytes } from 'node:crypto'
import { and, asc, count, desc, eq, gt, inArray, isNotNull, isNull, lt, max, notInArray, or, sql } from 'drizzle-orm'
import type { Db } from '../../db'
import { appSetting, auditLog, callStat, callStatHourly, personalAccessToken, upstream, upstreamOauth, upstreamRestTool, upstreamSecret, upstreamTool, user, userGatewayLimits, userInvite, userPreference } from '../../db/schema'
import { ACTIVE_WINDOW_MS, DEFAULT_LIMITS, INVITE_TTL_DAYS, ROLLUP_BUCKETS_MS, STATS } from '../config'
import type { Timeouts } from '../config'
import type { CallStatRow } from '../stats/buffer'
import { querySlowUpstreams, queryAdminStats, queryHealthHistory, queryStats, queryUpstreamOverview, queryUpstreamStats, type StatsQuery } from '../stats/query'
import type { RestTool, StatsWindow, ToolMode } from '#shared/api-types'
import type { StatusSnapshot } from './status'
import type { GatewayStore, SecretRow, UpstreamRow, UserLimits } from './types'
import { auditMeta, type AuditEntry } from '../../utils/audit'
import type { RestToolRow } from '../rest/adapter'

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
  slug: string, name: string, type: 'http' | 'stdio' | 'rest', description?: string | null, url?: string | null, transport?: string, authType?: string,
  authHeaderName?: string | null, ratePerMin?: number, maxConcurrent?: number, timeouts?: Partial<Timeouts> | null,
  command?: string | null, args?: string[], env?: Record<string, string>, cwd?: string | null, tags?: string[],
}

export class SlugTaken extends Error {}
export class LimitReached extends Error {}

export class GatewayRepo implements GatewayStore {
  constructor(readonly db: Db) {}

  // --- GatewayStore (runtime path) ---
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
  /** Default true (row missing). */
  async getNotifyStatusMail(userId: string): Promise<boolean> {
    const [r] = await this.db.select({ v: userPreference.notifyStatusMail }).from(userPreference).where(eq(userPreference.userId, userId))
    return r?.v ?? true
  }
  async setNotifyStatusMail(userId: string, value: boolean) {
    await this.db.insert(userPreference).values({ userId, notifyStatusMail: value }).onConflictDoUpdate({ target: userPreference.userId, set: { notifyStatusMail: value, updatedAt: new Date() } })
  }
  /** Default 'direct' (row missing). */
  async getToolMode(userId: string): Promise<ToolMode> {
    const [r] = await this.db.select({ v: userPreference.toolMode }).from(userPreference).where(eq(userPreference.userId, userId))
    return r?.v === 'meta' ? 'meta' : 'direct'
  }
  async setToolMode(userId: string, mode: ToolMode) {
    await this.db.insert(userPreference).values({ userId, toolMode: mode }).onConflictDoUpdate({ target: userPreference.userId, set: { toolMode: mode, updatedAt: new Date() } })
  }
  /** Preferences of F4 (mail switches, theme). Defaults apply while the row is missing. */
  async getPrefs(userId: string): Promise<{ notifyStatusMail: boolean, notifyNewClient: boolean, notifyWeekly: boolean, theme: 'system' | 'light' | 'dark' }> {
    const [r] = await this.db.select({ s: userPreference.notifyStatusMail, n: userPreference.notifyNewClient, w: userPreference.notifyWeekly, theme: userPreference.theme }).from(userPreference).where(eq(userPreference.userId, userId))
    return { notifyStatusMail: r?.s ?? true, notifyNewClient: r?.n ?? true, notifyWeekly: r?.w ?? false, theme: (r?.theme as 'system' | 'light' | 'dark' | undefined) ?? 'system' }
  }
  async patchPrefs(userId: string, p: { notifyNewClient?: boolean, notifyWeekly?: boolean, theme?: 'system' | 'light' | 'dark' }) {
    const now = new Date()
    // Switching the weekly summary on starts the 7 days from now (no mail the moment someone opts in).
    const starting = p.notifyWeekly === true && !(await this.getPrefs(userId)).notifyWeekly
    const extra = starting ? { weeklyLastSentAt: now } : {}
    await this.db.insert(userPreference).values({ userId, ...p, ...extra }).onConflictDoUpdate({ target: userPreference.userId, set: { ...p, ...extra, updatedAt: now } })
  }
  /** Claims the weekly mail for one user (conditional update: two instances never both send). */
  async claimWeekly(userId: string, before: Date, now: Date): Promise<boolean> {
    const r = await this.db.update(userPreference).set({ weeklyLastSentAt: now }).where(and(eq(userPreference.userId, userId), eq(userPreference.notifyWeekly, true), or(isNull(userPreference.weeklyLastSentAt), lt(userPreference.weeklyLastSentAt, before)))).returning({ id: userPreference.userId })
    return r.length > 0
  }
  /** Opted-in users whose last weekly summary is older than `before` (or missing). Banned users are skipped. */
  async weeklyDigestDue(before: Date): Promise<Array<{ userId: string, email: string, name: string }>> {
    const rows = await this.db.select({ userId: user.id, email: user.email, name: user.name, banned: user.banned, last: userPreference.weeklyLastSentAt })
      .from(userPreference).innerJoin(user, eq(user.id, userPreference.userId)).where(eq(userPreference.notifyWeekly, true))
    return rows.filter(r => r.banned !== true && (!r.last || r.last < before)).map(r => ({ userId: r.userId, email: r.email, name: r.name }))
  }
  /** Hands a claim back after a failed send (only if it is still the claim of this run). */
  async releaseWeekly(userId: string, claimedAt: Date) {
    await this.db.update(userPreference).set({ weeklyLastSentAt: null }).where(and(eq(userPreference.userId, userId), eq(userPreference.weeklyLastSentAt, claimedAt)))
  }
  /** Account erasure: rows of the user are removed by the FK cascade (upstreams, secrets, tools, stats, prefs, tokens, grants, sessions); audit rows have no FK and are deleted here. */
  async eraseUser(userId: string) {
    await this.db.delete(auditLog).where(or(eq(auditLog.userId, userId), eq(auditLog.actor, `user:${userId}`), and(eq(auditLog.targetType, 'user'), eq(auditLog.targetId, userId))))
    await this.db.delete(userInvite).where(eq(userInvite.createdBy, userId)) // invitations carry third-party addresses
    await this.db.delete(user).where(eq(user.id, userId))
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

  // --- REST tools ---
  /** Active definitions for the adapter (the runtime path). */
  async listRestTools(userId: string, upstreamId: string): Promise<RestToolRow[]> {
    const rows = await this.db.select().from(upstreamRestTool).where(and(eq(upstreamRestTool.userId, userId), eq(upstreamRestTool.upstreamId, upstreamId))).orderBy(asc(upstreamRestTool.name))
    return rows.map(r => ({
      id: r.id, name: r.name, description: r.description, method: r.method as RestToolRow['method'], urlTemplate: r.urlTemplate,
      inputSchema: r.inputSchema as RestToolRow['inputSchema'], headers: (r.headers as Record<string, string>) ?? {}, bodyTemplate: r.bodyTemplate, enabled: r.enabled,
    }))
  }
  async listRestToolRecords(userId: string, upstreamId: string): Promise<RestTool[]> {
    const rows = await this.db.select().from(upstreamRestTool).where(and(eq(upstreamRestTool.userId, userId), eq(upstreamRestTool.upstreamId, upstreamId))).orderBy(asc(upstreamRestTool.name))
    return rows.map(r => ({
      id: r.id, name: r.name, description: r.description, method: r.method as RestTool['method'], urlTemplate: r.urlTemplate,
      inputSchema: r.inputSchema as Record<string, unknown>, headers: (r.headers as Record<string, string>) ?? {}, bodyTemplate: r.bodyTemplate, enabled: r.enabled,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    }))
  }
  /** Replaces the whole set in one transaction (the editor always sends the full list). */
  async replaceRestTools(userId: string, upstreamId: string, tools: RestToolRow[]) {
    await this.db.transaction(async (tx) => {
      await tx.delete(upstreamRestTool).where(and(eq(upstreamRestTool.userId, userId), eq(upstreamRestTool.upstreamId, upstreamId)))
      if (tools.length) {
        await tx.insert(upstreamRestTool).values(tools.map(t => ({
          upstreamId, userId, name: t.name, description: t.description, method: t.method, urlTemplate: t.urlTemplate,
          inputSchema: t.inputSchema, headers: t.headers, bodyTemplate: t.bodyTemplate, enabled: t.enabled,
        })))
      }
    })
  }

  // --- Upstream management ---
  async countUpstreams(userId: string) {
    const [r] = await this.db.select({ n: count() }).from(upstream).where(eq(upstream.userId, userId))
    return r?.n ?? 0
  }
  async listUpstreams(userId: string): Promise<Array<UpstreamDb & { toolsEnabled: number, toolsTotal: number, secretNames: string[] }>> {
    const rows = await this.db.select().from(upstream).where(eq(upstream.userId, userId)).orderBy(asc(upstream.name))
    const tools = await this.db.select({ upstreamId: upstreamTool.upstreamId, enabled: upstreamTool.enabled }).from(upstreamTool).where(and(eq(upstreamTool.userId, userId), eq(upstreamTool.gone, false)))
    const secrets = await this.db.select({ upstreamId: upstreamSecret.upstreamId, kind: upstreamSecret.kind, name: upstreamSecret.name }).from(upstreamSecret).where(eq(upstreamSecret.userId, userId))
    const oauth = await this.db.select({ upstreamId: upstreamOauth.upstreamId }).from(upstreamOauth).where(and(eq(upstreamOauth.userId, userId), isNotNull(upstreamOauth.connectedAt)))
    return rows.map(r => ({
      ...r,
      toolsTotal: tools.filter(t => t.upstreamId === r.id).length,
      toolsEnabled: tools.filter(t => t.upstreamId === r.id && t.enabled).length,
      secretNames: [
        ...secrets.filter(s => s.upstreamId === r.id).map(s => (s.kind === 'bearer' ? 'bearer' : s.name)),
        ...(r.authType === 'oauth' && oauth.some(o => o.upstreamId === r.id) ? ['oauth'] : []),
      ],
    }))
  }
  async getUpstreamDetail(userId: string, id: string) {
    return (await this.listUpstreams(userId)).find(u => u.id === id) ?? null
  }

  /** Creates; `limit` is checked against the count in the same transaction (no exceeding through races). */
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
        timeouts: p.timeouts ?? null, tags: p.tags ?? [], setup, status: 'unknown',
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

  // --- OAuth session of an upstream (ciphertext only; encryption lives in upstream/oauth.ts) ---
  async getOAuth(userId: string, upstreamId: string) {
    const [r] = await this.db.select().from(upstreamOauth).where(and(eq(upstreamOauth.userId, userId), eq(upstreamOauth.upstreamId, upstreamId)))
    return r ?? null
  }
  /** Upsert; `pending` undefined keeps the stored state, `null` clears it. `connected` sets or clears `connectedAt`. */
  async saveOAuth(userId: string, upstreamId: string, p: { data: string | null, pending?: { stateHash: string, expiresAt: Date } | null, connected: boolean }) {
    const pending = p.pending === undefined ? {} : { stateHash: p.pending?.stateHash ?? null, stateExpiresAt: p.pending?.expiresAt ?? null }
    const connectedAt = p.connected ? sql`coalesce(${upstreamOauth.connectedAt}, now())` : null
    await this.db.insert(upstreamOauth).values({ userId, upstreamId, data: p.data, ...pending, connectedAt: p.connected ? new Date() : null })
      .onConflictDoUpdate({ target: upstreamOauth.upstreamId, set: { data: p.data, ...pending, connectedAt, updatedAt: new Date() } })
  }
  /** Single use: returns the row of a still valid `state` hash and clears the state in the same statement. */
  async consumeOAuthState(stateHash: string, now = new Date()) {
    const [r] = await this.db.update(upstreamOauth).set({ stateHash: null, stateExpiresAt: null, updatedAt: now })
      .where(and(eq(upstreamOauth.stateHash, stateHash), gt(upstreamOauth.stateExpiresAt, now))).returning({ userId: upstreamOauth.userId, upstreamId: upstreamOauth.upstreamId })
    return r ?? null
  }
  async deleteOAuth(userId: string, upstreamId: string) {
    await this.db.delete(upstreamOauth).where(and(eq(upstreamOauth.userId, userId), eq(upstreamOauth.upstreamId, upstreamId)))
  }

  async listToolRows(userId: string, upstreamId: string) {
    return await this.db.select().from(upstreamTool).where(and(eq(upstreamTool.userId, userId), eq(upstreamTool.upstreamId, upstreamId))).orderBy(asc(upstreamTool.name))
  }
  async setToolEnabled(userId: string, upstreamId: string, name: string, enabled: boolean) {
    const [r] = await this.db.update(upstreamTool).set({ enabled }).where(and(eq(upstreamTool.userId, userId), eq(upstreamTool.upstreamId, upstreamId), eq(upstreamTool.name, name), eq(upstreamTool.gone, false))).returning()
    return r ?? null
  }

  /** Status change (called only on a change). */
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

  // --- Settings (app_setting) ---
  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const [r] = await this.db.select().from(appSetting).where(eq(appSetting.key, key))
    return r ? r.value as T : fallback
  }
  async setSetting(key: string, value: unknown) {
    await this.db.insert(appSetting).values({ key, value }).onConflictDoUpdate({ target: appSetting.key, set: { value, updatedAt: new Date() } })
  }

  // --- Invitations ---
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
  /** Atomic: exactly one caller wins (conditional UPDATE, the database decides the race). */
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
  /** Releases a claimed invitation if creating the user failed afterwards. */
  async releaseInvite(inviteId: string) {
    await this.db.update(userInvite).set({ usedAt: null }).where(and(eq(userInvite.id, inviteId), isNull(userInvite.usedBy)))
  }

  // --- Users (admin) ---
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

  // --- Measurement data ---
  async writeStats(rows: CallStatRow[]) {
    if (!rows.length) return
    // Upstreams that have been deleted in the meantime: keep the measurement (the slug is in the row), set the reference to null
    const ids = [...new Set(rows.map(r => r.upstreamId).filter((x): x is string => !!x))]
    const alive = new Set(ids.length ? (await this.db.select({ id: upstream.id }).from(upstream).where(inArray(upstream.id, ids))).map(r => r.id) : [])
    rows = rows.map(r => (r.upstreamId && !alive.has(r.upstreamId) ? { ...r, upstreamId: null } : r))
    await this.db.insert(callStat).values(rows.map(r => ({
      ts: r.ts, userId: r.userId, clientId: r.clientId, tokenId: r.tokenId, upstreamId: r.upstreamId, upstreamSlug: r.upstreamSlug, tool: r.tool, kind: r.kind,
      status: r.status, totalMs: r.totalMs, upstreamMs: r.upstreamMs, overheadMs: r.overheadMs, retries: r.retries, reqBytes: r.reqBytes, resBytes: r.resBytes, cacheHit: r.cacheHit,
    })))
  }
  /**
   * Daily cleanup (spec P0-15): raw rows older than `retentionDays` move into the hourly rollup (counters, sums and a duration
   * histogram) and are then deleted in the same transaction, so nothing is counted twice or lost. Rollups older than
   * `rollupRetentionDays` (13 months) are dropped. Returns the number of raw rows removed.
   */
  async purgeStats(retentionDays: number, now = new Date(), rollupRetentionDays: number = STATS.rollupRetentionDays) {
    const cutoff = new Date(now.getTime() - retentionDays * 86_400_000)
    const bounds = ROLLUP_BUCKETS_MS
    const bucketCols = sql.join([...bounds.map((b, i) => sql`count(*) filter (where total_ms <= ${b} and ${i === 0 ? sql`true` : sql`total_ms > ${bounds[i - 1]!}`}) as ${sql.raw(`b${i}`)}`), sql`count(*) filter (where total_ms > ${bounds.at(-1)!}) as ${sql.raw(`b${bounds.length}`)}`], sql`, `)
    return await this.db.transaction(async (tx) => {
      const agg = await tx.execute(sql`select date_trunc('hour', ts) as hour, user_id, upstream_slug, coalesce(tool, '') as tool, status, count(*) as calls,
        sum(total_ms) as total_sum, max(total_ms) as max_ms, coalesce(sum(overhead_ms), 0) as oh_sum, count(overhead_ms) as oh_calls, ${bucketCols}
        from call_stat where ts < ${cutoff} and kind = 'call' group by 1, 2, 3, 4, 5`)
      const rows = (Array.isArray(agg) ? agg : ((agg as { rows?: Array<Record<string, unknown>> }).rows ?? [])) as Array<Record<string, unknown>>
      for (const r of rows) {
        const hist = Array.from({ length: bounds.length + 1 }, (_, i) => Number(r[`b${i}`]))
        await tx.insert(callStatHourly).values({
          hour: new Date(String(r.hour)), userId: String(r.user_id), upstreamSlug: String(r.upstream_slug), tool: String(r.tool), status: String(r.status),
          calls: Number(r.calls), totalMsSum: Number(r.total_sum), maxMs: Number(r.max_ms), overheadMsSum: Number(r.oh_sum), overheadCalls: Number(r.oh_calls), hist,
        }).onConflictDoUpdate({
          target: [callStatHourly.hour, callStatHourly.userId, callStatHourly.upstreamSlug, callStatHourly.tool, callStatHourly.status],
          // A partial hour can be rolled up twice (rows of one hour straddling the cutoff on two days): add up, never overwrite.
          set: {
            calls: sql`${callStatHourly.calls} + excluded.calls`, totalMsSum: sql`${callStatHourly.totalMsSum} + excluded.total_ms_sum`,
            maxMs: sql`greatest(${callStatHourly.maxMs}, excluded.max_ms)`, overheadMsSum: sql`${callStatHourly.overheadMsSum} + excluded.overhead_ms_sum`,
            overheadCalls: sql`${callStatHourly.overheadCalls} + excluded.overhead_calls`,
            hist: sql`(select jsonb_agg((a.v)::int + (b.v)::int order by a.i) from jsonb_array_elements(${callStatHourly.hist}) with ordinality as a(v, i) join jsonb_array_elements(excluded.hist) with ordinality as b(v, i) on a.i = b.i)`,
          },
        })
      }
      const r = await tx.delete(callStat).where(lt(callStat.ts, cutoff)).returning({ id: callStat.id })
      await tx.delete(callStatHourly).where(lt(callStatHourly.hour, new Date(now.getTime() - rollupRetentionDays * 86_400_000)))
      return r.length
    })
  }
  async statsSummary(q: StatsQuery, now = new Date()) { return await queryStats(this.db, q, now) }
  async upstreamStats(q: { userId: string, slug: string, window: StatsWindow }, now = new Date()) { return await queryUpstreamStats(this.db, q, now) }
  async healthHistory(q: { userId: string, slug: string }, now = new Date()) { return await queryHealthHistory(this.db, q, now) }
  async upstreamOverview(q: { userId: string, window: StatsWindow }, now = new Date()) { return await queryUpstreamOverview(this.db, q, now) }
  async slowUpstreams(now = new Date()) { return await querySlowUpstreams(this.db, now) }
  async adminStats(window: StatsWindow, now = new Date()) { return await queryAdminStats(this.db, window, now) }

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
    return await this.db.select({ id: personalAccessToken.id, name: personalAccessToken.name, deviceName: personalAccessToken.deviceName, lastUsedAt: personalAccessToken.lastUsedAt }).from(personalAccessToken).where(and(eq(personalAccessToken.userId, userId), isNull(personalAccessToken.revokedAt)))
  }
}
