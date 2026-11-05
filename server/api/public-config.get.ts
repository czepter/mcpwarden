import { count } from 'drizzle-orm'
import type { PublicConfig } from '#shared/api-types'
import { getDb } from '../db'
import { user } from '../db/schema/auth'
import { getMailer } from '../mail'
import { noStore } from '../utils/api'

/**
 * Public (the login page needs it before sign-in). Reveals only whether mail features are active
 * and whether registration without an invitation is open (exactly when no user exists yet).
 */
export default defineEventHandler(async (event): Promise<PublicConfig> => {
  noStore(event)
  const db = await getDb()
  const n = (await db.select({ n: count() }).from(user))[0]?.n ?? 0
  return { mail: getMailer().enabled, registrationOpen: n === 0 } satisfies PublicConfig
})
