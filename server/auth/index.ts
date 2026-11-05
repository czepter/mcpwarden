import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { count } from 'drizzle-orm'
import { getDb } from '../db'
import { user } from '../db/schema'
import { getConfig } from '../utils/config'
import { buildAuthOptions } from './options'

function create() {
  return getDb().then((db) => {
    const cfg = getConfig()
    return betterAuth({
      ...buildAuthOptions({
        baseUrl: cfg.baseUrl.origin,
        secret: cfg.betterAuthSecret,
        allowedOrigins: cfg.allowedOrigins,
        rateLimitEnabled: cfg.rateLimitEnabled,
        countUsers: async () => (await db.select({ n: count() }).from(user))[0]?.n ?? 0,
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
