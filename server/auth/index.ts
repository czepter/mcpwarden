import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { count } from 'drizzle-orm'
import { getDb } from '../db'
import { getMailer } from '../mail'
import { user } from '../db/schema'
import { getConfig } from '../utils/config'
import { runUserBanned } from '../utils/user-lifecycle'
import { GatewayRepo } from '../gateway/upstream/repo'
import { getRegistrationPolicy, recordClientMeta, seedAllowlist } from './dcr-store'
import { buildAuthOptions } from './options'

function create() {
  return getDb().then(async (db) => {
    await seedAllowlist(db)
    const cfg = getConfig()
    return betterAuth({
      ...buildAuthOptions({
        baseUrl: cfg.baseUrl.origin,
        secret: cfg.betterAuthSecret,
        allowedOrigins: cfg.allowedOrigins,
        rateLimitEnabled: cfg.rateLimitEnabled,
        trustProxy: cfg.trustProxy,
        invites: (() => {
          const repo = new GatewayRepo(db)
          return {
            check: async (token, email) => {
              const inv = await repo.inviteByToken(token)
              return !!inv && repo.inviteStatus(inv) === 'open' && (!inv.email || inv.email === email.toLowerCase())
            },
            claim: (token, email) => repo.claimInvite(token, email),
            bind: async (inviteId, userId) => {
              await repo.setInviteUsedBy(inviteId, userId)
              await repo.audit({ userId: null, actor: `user:${userId}`, action: 'invite.use', targetType: 'invite', targetId: inviteId, scope: 'instance', category: 'management', result: 'success' }).catch(() => {})
            },
          }
        })(),
        mailer: getMailer(),
        lifecycle: { onUserBanned: runUserBanned },
        countUsers: async () => (await db.select({ n: count() }).from(user))[0]?.n ?? 0,
        dcr: {
          getPolicy: () => getRegistrationPolicy(db),
          recordRegistration: (clientId, allowlisted) => recordClientMeta(db, clientId, allowlisted),
        },
      }),
      database: drizzleAdapter(db, { provider: 'pg' }),
    })
  })
}

export type Auth = Awaited<ReturnType<typeof create>>

const g = globalThis as typeof globalThis & { __mcpwAuth?: Promise<Auth> }

/** Memoisiert; wartet auf getDb() (also auf die Migration). */
export function getAuth(): Promise<Auth> {
  return (g.__mcpwAuth ??= create())
}

/** Setzt die memoisierte Instanz zurueck (Shutdown). */
export function resetAuth(): void {
  g.__mcpwAuth = undefined
}
