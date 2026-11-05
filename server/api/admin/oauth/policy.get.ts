import type { DcrPolicy } from '#shared/api-types'
import { getDcrMode } from '../../../auth/dcr-store'
import { getDb } from '../../../db'
import { noStore } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event): Promise<DcrPolicy> => {
  await requireAdmin(event)
  noStore(event)
  return { mode: await getDcrMode(await getDb()) } satisfies DcrPolicy
})
