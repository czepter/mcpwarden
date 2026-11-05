import type { AllowlistList } from '#shared/api-types'
import { listAllowlist, resetBuiltins } from '../../../../auth/dcr-store'
import { getDb } from '../../../../db'
import { requireAdmin } from '../../../../utils/session'

export default defineEventHandler(async (event): Promise<AllowlistList> => {
  await requireAdmin(event)
  const db = await getDb()
  await resetBuiltins(db)
  return { items: await listAllowlist(db) } satisfies AllowlistList
})
