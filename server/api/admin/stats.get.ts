import type { AdminStats } from '#shared/api-types'
import { getRuntime, statsDropped } from '../../gateway/runtime'
import * as svc from '../../gateway/service'
import { noStore } from '../../utils/api'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const rt = await getRuntime()
  noStore(event)
  return await svc.adminStats(rt, getQuery(event), statsDropped()) satisfies AdminStats
})
