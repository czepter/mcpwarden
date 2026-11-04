/** DB-Zugriff fuer PATs und die Clients (Consents) eines Nutzers (Plan 0b, Aufgabe 5). Jede Query filtert nach `userId`. */
import { and, count, eq, isNull } from 'drizzle-orm'
import type { ConnectionSummary, PatList, PatSummary } from '../../shared/api-types'
import type { Db } from '../db'
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from '../db/schema/auth'
import { oauthConnectionUse, personalAccessToken } from '../db/schema/mcp'
import { isActive } from './client-meta'
import { isAllowlisted, redirectHost, sanitizeClientName } from './dcr-policy'
import { listAllowlist, UUID_RE } from './dcr-store'
import { generatePat, PAT_LIMIT } from './pat'

const toSummary = (r: typeof personalAccessToken.$inferSelect): PatSummary => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  revokedAt: r.revokedAt?.toISOString() ?? null,
})

export async function listPats(db: Db, userId: string): Promise<PatList> {
  const rows = await db.select().from(personalAccessToken).where(eq(personalAccessToken.userId, userId)).orderBy(personalAccessToken.createdAt)
  return { items: rows.map(toSummary), limit: { max: PAT_LIMIT, active: rows.filter(r => !r.revokedAt).length } }
}

/** `null` bei erreichtem Limit. Der Klartext verlaesst diese Funktion nur im Rueckgabewert. */
export async function createPat(db: Db, userId: string, name: string): Promise<(PatSummary & { token: string }) | null> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(personalAccessToken).where(and(eq(personalAccessToken.userId, userId), isNull(personalAccessToken.revokedAt)))
  if (n >= PAT_LIMIT) return null
  const g = generatePat()
  const [row] = await db.insert(personalAccessToken).values({ userId, name, tokenHash: g.hash, prefix: g.prefix }).returning()
  return { ...toSummary(row!), token: g.token }
}

/** `false` = PAT gehoert nicht diesem Nutzer / existiert nicht. Idempotent fuer bereits widerrufene. */
export async function revokePat(db: Db, userId: string, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false
  const owned = await db.select({ id: personalAccessToken.id }).from(personalAccessToken).where(and(eq(personalAccessToken.id, id), eq(personalAccessToken.userId, userId)))
  if (owned.length === 0) return false
  await db.update(personalAccessToken).set({ revokedAt: new Date() }).where(and(eq(personalAccessToken.id, id), eq(personalAccessToken.userId, userId), isNull(personalAccessToken.revokedAt)))
  return true
}

export async function listConnections(db: Db, userId: string, now: Date): Promise<ConnectionSummary[]> {
  const [consents, uses, allowlist] = await Promise.all([
    db.select({ consent: oauthConsent, client: oauthClient }).from(oauthConsent).innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId)).where(eq(oauthConsent.userId, userId)),
    db.select().from(oauthConnectionUse).where(eq(oauthConnectionUse.userId, userId)),
    listAllowlist(db),
  ])
  const useBy = new Map(uses.map(u => [u.clientId, u.lastUsedAt]))
  return consents
    .map(({ consent, client }) => {
      const name = sanitizeClientName(client.name)
      const last = useBy.get(client.clientId) ?? null
      return {
        clientId: client.clientId,
        name,
        scopes: consent.scopes,
        redirectHost: redirectHost(client.redirectUris[0] ?? ''),
        allowlisted: isAllowlisted(allowlist, name, client.redirectUris),
        grantedAt: consent.createdAt.toISOString(),
        lastUsedAt: last?.toISOString() ?? null,
        active: isActive(last, now),
      } satisfies ConnectionSummary
    })
    .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt))
}

/** Consent plus Refresh-/Access-Tokens dieses Clients fuer diesen Nutzer. `false` = kein Consent dieses Nutzers. */
export async function revokeConnection(db: Db, userId: string, clientId: string): Promise<boolean> {
  const deleted = await db.delete(oauthConsent).where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))).returning({ id: oauthConsent.id })
  if (deleted.length === 0) return false
  await db.delete(oauthAccessToken).where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)))
  await db.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)))
  await db.delete(oauthConnectionUse).where(and(eq(oauthConnectionUse.userId, userId), eq(oauthConnectionUse.clientId, clientId)))
  return true
}
