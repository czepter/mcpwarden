import { getRuntime } from '../../../../gateway/runtime'
import * as svc from '../../../../gateway/service'
import { noContent, noStore, readObject } from '../../../../utils/api'
import { requireAdmin } from '../../../../utils/session'
import { authAdminApi } from '../../../../gateway/auth-admin'

export default defineEventHandler(async (event) => {
  const { user } = await svc.admitAdminAction(requireAdmin(event))
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  const api = await authAdminApi(event)
  await svc.adminBan(rt, who, api, getRouterParam(event, 'id') ?? '', (await readObject(event)).reason)
  return noContent(event)
})
