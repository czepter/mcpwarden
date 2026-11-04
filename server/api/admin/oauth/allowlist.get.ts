import type { AllowlistList } from '#shared/api-types'
import { listAllowlist } from '../../../auth/dcr-store'
import { getDb } from '../../../db'
import { noStore } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event): Promise<AllowlistList> => {
  await requireAdmin(event)
  noStore(event)
  return { items: await listAllowlist(await getDb()) } satisfies AllowlistList
})
