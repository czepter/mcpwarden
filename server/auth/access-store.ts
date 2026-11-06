/** Drizzle implementation of the `AccessStore` (plan 0b, task 6): one indexed query per request. */
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db'
import { oauthClient, oauthConsent, oauthRefreshToken, user } from '../db/schema/auth'
import { oauthConnectionUse, personalAccessToken } from '../db/schema/mcp'
import type { AccessStore, UserRow } from './access-guard'

const toUser = (u: { id: string, role: string | null, banned: boolean | null, banExpires: Date | null }): UserRow => ({
  id: u.id, role: u.role === 'admin' ? 'admin' : 'user', banned: u.banned === true, banExpires: u.banExpires,
})

export function createDrizzleAccessStore(db: Db): AccessStore {
  return {
    async loadOAuthAccess(userId, clientId, now) {
      const [row] = await db.select({
        id: user.id, role: user.role, banned: user.banned, banExpires: user.banExpires,
        cId: oauthClient.clientId, cName: oauthClient.name, cDisabled: oauthClient.disabled,
        hasConsent: sql<boolean>`exists (select 1 from ${oauthConsent} where ${oauthConsent.userId} = ${user.id} and ${oauthConsent.clientId} = ${clientId})`,
        // Live refresh token: not revoked, not expired (review B11; offline_access is a required scope).
        hasLiveRefreshToken: sql<boolean>`exists (select 1 from ${oauthRefreshToken} where ${oauthRefreshToken.userId} = ${user.id} and ${oauthRefreshToken.clientId} = ${clientId} and ${oauthRefreshToken.revoked} is null and ${oauthRefreshToken.expiresAt} > ${now})`,
      }).from(user).leftJoin(oauthClient, eq(oauthClient.clientId, clientId)).where(eq(user.id, userId)).limit(1)
      if (!row) return { user: null, client: null, hasConsent: false, hasLiveRefreshToken: false }
      return {
        user: toUser(row),
        client: row.cId ? { id: row.cId, name: row.cName, disabled: row.cDisabled === true } : null,
        hasConsent: row.hasConsent === true,
        hasLiveRefreshToken: row.hasLiveRefreshToken === true,
      }
    },
    async loadPatAccess(tokenHash) {
      const [row] = await db.select({
        patId: personalAccessToken.id, hash: personalAccessToken.tokenHash, revokedAt: personalAccessToken.revokedAt, expiresAt: personalAccessToken.expiresAt, upstreamIds: personalAccessToken.upstreamIds,
        id: user.id, role: user.role, banned: user.banned, banExpires: user.banExpires,
      }).from(personalAccessToken).innerJoin(user, eq(user.id, personalAccessToken.userId)).where(eq(personalAccessToken.tokenHash, tokenHash)).limit(1)
      return row ? { pat: { id: row.patId, tokenHash: row.hash, revokedAt: row.revokedAt, expiresAt: row.expiresAt, upstreamIds: row.upstreamIds }, user: toUser(row) } : null
    },
    async touchConnection(userId, clientId, now) {
      await db.insert(oauthConnectionUse).values({ userId, clientId, lastUsedAt: now })
        .onConflictDoUpdate({ target: [oauthConnectionUse.userId, oauthConnectionUse.clientId], set: { lastUsedAt: now } })
    },
    async touchPat(patId, now) {
      await db.update(personalAccessToken).set({ lastUsedAt: now }).where(and(eq(personalAccessToken.id, patId)))
    },
  }
}
