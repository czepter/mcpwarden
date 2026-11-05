import type { PublicConfig } from '#shared/api-types'
import { getMailer } from '../mail'
import { noStore } from '../utils/api'

/** Oeffentlich (Login-Seite braucht es vor der Anmeldung). Verraet nur, ob Mailfunktionen aktiv sind. */
export default defineEventHandler((event): PublicConfig => {
  noStore(event)
  return { mail: getMailer().enabled } satisfies PublicConfig
})
