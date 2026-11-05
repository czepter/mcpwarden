import { getRuntime } from '../../../../gateway/runtime'
import * as svc from '../../../../gateway/service'
import { noContent, noStore } from '../../../../utils/api'
import { requireAdmin } from '../../../../utils/session'
import { authAdminApi } from '../../../../gateway/auth-admin'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdmin(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  const api = await authAdminApi(event)
  await svc.adminUnban(rt, who, api, getRouterParam(event, 'id') ?? '')
  return noContent(event)
})
