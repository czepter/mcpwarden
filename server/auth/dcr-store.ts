/**
 * DB access for DCR policy, allowlist and client management (plan 0b, task 3).
 * Takes `Db` (no Nitro) so that unit tests run with in-memory PGlite.
 */
import { and, count, eq, inArray, isNull, lt, max } from 'drizzle-orm'
import type { AllowlistEntry, AllowlistInput, DcrMode, OAuthClientAdmin } from '../../shared/api-types'
import type { Db } from '../db'
import { appSetting, dcrAllowlist, oauthClientMeta, oauthConnectionUse } from '../db/schema/mcp'
import { oauthClient, oauthConsent } from '../db/schema/auth'
import { BUILTIN_ALLOWLIST, isAllowlisted, sanitizeClientName, type AllowlistPattern } from './dcr-policy'
import { CLIENT_EXPIRY_MS, clientExpiresAt } from './client-meta'

const KEY_MODE = 'oauth.dcr_mode'
const KEY_SEEDED = 'oauth.allowlist_seeded'
const MODES: readonly DcrMode[] = ['off', 'allowlist', 'open']
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isDcrMode(v: unknown): v is DcrMode {
  return typeof v === 'string' && (MODES as readonly string[]).includes(v)
}

export async function getDcrMode(db: Db): Promise<DcrMode> {
  const [row] = await db.select().from(appSetting).where(eq(appSetting.key, KEY_MODE))
  return isDcrMode(row?.value) ? row.value : 'open'
}

export async function setDcrMode(db: Db, mode: DcrMode): Promise<void> {
  await db.insert(appSetting).values({ key: KEY_MODE, value: mode })
    .onConflictDoUpdate({ target: appSetting.key, set: { value: mode, updatedAt: new Date() } })
}

const toEntry = (r: typeof dcrAllowlist.$inferSelect): AllowlistEntry => ({
  id: r.id, label: r.label, namePattern: r.namePattern, redirectPatterns: r.redirectPatterns, builtin: r.builtin, createdAt: r.createdAt.toISOString(),
})

export async function listAllowlist(db: Db): Promise<AllowlistEntry[]> {
  const rows = await db.select().from(dcrAllowlist).orderBy(dcrAllowlist.builtin, dcrAllowlist.createdAt, dcrAllowlist.label)
  return rows.map(toEntry)
}

export async function getRegistrationPolicy(db: Db): Promise<{ mode: DcrMode, allowlist: AllowlistPattern[] }> {
  return { mode: await getDcrMode(db), allowlist: await listAllowlist(db) }
}

/** Idempotent and only once per database (marker in `app_setting`); deleted entries do not come back. */
export async function seedAllowlist(db: Db): Promise<void> {
  const inserted = await db.insert(appSetting).values({ key: KEY_SEEDED, value: true }).onConflictDoNothing().returning({ key: appSetting.key })
  if (inserted.length === 0) return
  await db.insert(dcrAllowlist).values(BUILTIN_ALLOWLIST.map(e => ({ ...e, redirectPatterns: [...e.redirectPatterns], builtin: true })))
}

/** Restores missing presets (does not overwrite changed builtins; there is no editing). */
export async function resetBuiltins(db: Db): Promise<void> {
  const existing = new Set((await db.select({ label: dcrAllowlist.label }).from(dcrAllowlist).where(eq(dcrAllowlist.builtin, true))).map(r => r.label))
  const missing = BUILTIN_ALLOWLIST.filter(e => !existing.has(e.label))
  if (missing.length) await db.insert(dcrAllowlist).values(missing.map(e => ({ ...e, redirectPatterns: [...e.redirectPatterns], builtin: true })))
}

const PATTERN_RE = /^([a-z][a-z0-9+.-]*):\/\/\S*$/i
const BAD_PATTERN_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'ftp', 'ws', 'wss'])

export function validateAllowlistInput(v: unknown): { ok: true, value: AllowlistInput } | { ok: false, field: string } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const label = typeof o.label === 'string' ? o.label.trim() : ''
  if (label.length < 1 || label.length > 64) return { ok: false, field: 'label' }
  const namePattern = typeof o.namePattern === 'string' ? o.namePattern.trim() : ''
  if (namePattern.length < 1 || namePattern.length > 80) return { ok: false, field: 'namePattern' }
  const rp = o.redirectPatterns
  if (!Array.isArray(rp) || rp.length < 1 || rp.length > 20) return { ok: false, field: 'redirectPatterns' }
  const redirectPatterns: string[] = []
  for (const p of rp) {
    const m = typeof p === 'string' && p.length <= 512 ? PATTERN_RE.exec(p) : null
    if (!m || BAD_PATTERN_SCHEMES.has(m[1]!.toLowerCase()) || (m[1]!.toLowerCase() === 'http' && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:(\*|\d+))?(\/|$)/i.test(p as string))) {
      return { ok: false, field: 'redirectPatterns' }
    }
    redirectPatterns.push(p as string)
  }
  return { ok: true, value: { label, namePattern, redirectPatterns } }
}

export async function addAllowlistEntry(db: Db, input: AllowlistInput): Promise<AllowlistEntry> {
  const [row] = await db.insert(dcrAllowlist).values({ ...input, builtin: false }).returning()
  return toEntry(row!)
}

export async function removeAllowlistEntry(db: Db, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false
  return (await db.delete(dcrAllowlist).where(eq(dcrAllowlist.id, id)).returning({ id: dcrAllowlist.id })).length > 0
}

export async function recordClientMeta(db: Db, clientId: string, allowlisted: boolean, via: 'dcr' | 'admin' = 'dcr'): Promise<void> {
  await db.insert(oauthClientMeta).values({ clientId, allowlisted, registeredVia: via }).onConflictDoNothing()
}

type ClientRow = typeof oauthClient.$inferSelect

function toAdminClient(c: ClientRow, meta: typeof oauthClientMeta.$inferSelect | undefined, lastUsed: Date | null, users: number, allowlist: readonly AllowlistPattern[]): OAuthClientAdmin {
  const createdAt = meta?.createdAt ?? c.createdAt ?? new Date(0)
  return {
    id: c.clientId,
    name: sanitizeClientName(c.name),
    redirectUris: c.redirectUris,
    createdAt: createdAt.toISOString(),
    lastUsedAt: lastUsed?.toISOString() ?? null,
    userCount: users,
    allowlisted: isAllowlisted(allowlist, sanitizeClientName(c.name), c.redirectUris),
    registeredVia: meta?.registeredVia ?? 'admin',
    disabled: c.disabled === true,
    expiresAt: clientExpiresAt(createdAt, lastUsed),
  }
}

export async function listAdminClients(db: Db): Promise<OAuthClientAdmin[]> {
  const [clients, metas, uses, consents, allowlist] = await Promise.all([
    db.select().from(oauthClient),
    db.select().from(oauthClientMeta),
    db.select({ clientId: oauthConnectionUse.clientId, last: max(oauthConnectionUse.lastUsedAt) }).from(oauthConnectionUse).groupBy(oauthConnectionUse.clientId),
    db.select({ clientId: oauthConsent.clientId, n: count() }).from(oauthConsent).groupBy(oauthConsent.clientId),
    listAllowlist(db),
  ])
  const metaBy = new Map(metas.map(m => [m.clientId, m]))
  const useBy = new Map(uses.map(u => [u.clientId, u.last]))
  const consentBy = new Map(consents.map(c => [c.clientId, c.n]))
  return clients
    .map(c => toAdminClient(c, metaBy.get(c.clientId), useBy.get(c.clientId) ?? null, consentBy.get(c.clientId) ?? 0, allowlist))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function getAdminClient(db: Db, clientId: string): Promise<OAuthClientAdmin | null> {
  return (await listAdminClients(db)).find(c => c.id === clientId) ?? null
}

export async function setClientDisabled(db: Db, clientId: string, disabled: boolean): Promise<boolean> {
  return (await db.update(oauthClient).set({ disabled, updatedAt: new Date() }).where(eq(oauthClient.clientId, clientId)).returning({ id: oauthClient.id })).length > 0
}

/** Users with consent for this client (for `closeUserStreams` after deactivating/deleting). */
export async function consentUserIds(db: Db, clientId: string): Promise<string[]> {
  const rows = await db.select({ u: oauthConsent.userId }).from(oauthConsent).where(eq(oauthConsent.clientId, clientId))
  return [...new Set(rows.map(r => r.u).filter((u): u is string => !!u))]
}

/** Deletes the client; consents, tokens, meta and usage rows follow via foreign-key cascade. */
export async function deleteClient(db: Db, clientId: string): Promise<boolean> {
  return (await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId)).returning({ id: oauthClient.id })).length > 0
}

/** Expiry: registered via DCR, never used, older than 30 days. Returns the number of deleted clients. */
export async function deleteExpiredClients(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - CLIENT_EXPIRY_MS)
  const stale = await db.select({ clientId: oauthClientMeta.clientId }).from(oauthClientMeta)
    .leftJoin(oauthConnectionUse, eq(oauthConnectionUse.clientId, oauthClientMeta.clientId))
    .where(and(eq(oauthClientMeta.registeredVia, 'dcr'), lt(oauthClientMeta.createdAt, cutoff), isNull(oauthConnectionUse.clientId)))
  if (stale.length === 0) return 0
  const doomed = stale.map(s => s.clientId)
  await db.delete(oauthClient).where(inArray(oauthClient.clientId, doomed))
  return doomed.length
}
