import { getRuntime } from '../../../gateway/runtime'
import * as svc from '../../../gateway/service'
import { noContent, noStore } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdmin(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  await svc.adminRevokeInvite(rt, who, getRouterParam(event, 'id') ?? '')
  return noContent(event)
})
