import { count } from 'drizzle-orm'
import type { PublicConfig } from '#shared/api-types'
import { getDb } from '../db'
import { user } from '../db/schema/auth'
import { getMailer } from '../mail'
import { noStore } from '../utils/api'

/**
 * Oeffentlich (Login-Seite braucht es vor der Anmeldung). Verraet nur, ob Mailfunktionen aktiv sind
 * und ob die Registrierung ohne Einladung offen ist (genau dann, wenn noch kein Nutzer existiert).
 */
export default defineEventHandler(async (event): Promise<PublicConfig> => {
  noStore(event)
  const db = await getDb()
  const n = (await db.select({ n: count() }).from(user))[0]?.n ?? 0
  return { mail: getMailer().enabled, registrationOpen: n === 0 } satisfies PublicConfig
})
