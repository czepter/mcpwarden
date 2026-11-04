import type { OAuthClientAdminList } from '#shared/api-types'
import { listAdminClients } from '../../../auth/dcr-store'
import { getDb } from '../../../db'
import { noStore } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event): Promise<OAuthClientAdminList> => {
  await requireAdmin(event)
  noStore(event)
  return { items: await listAdminClients(await getDb()) } satisfies OAuthClientAdminList
})
