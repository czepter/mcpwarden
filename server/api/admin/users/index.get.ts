import type { AdminUserList } from '#shared/api-types'
import { getRuntime } from '../../../gateway/runtime'
import * as svc from '../../../gateway/service'
import { noStore } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const rt = await getRuntime()
  noStore(event)
  return await svc.adminListUsers(rt) satisfies AdminUserList
})
