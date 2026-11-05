import type { InviteCreated } from '#shared/api-types'
import { getRuntime } from '../../../gateway/runtime'
import * as svc from '../../../gateway/service'
import { noStore, readObject } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'
import { getConfig } from '../../../utils/config'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdmin(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  const r = await svc.adminCreateInvite(rt, who, getConfig().baseUrl, (await readObject(event)).email)
  setResponseStatus(event, 201)
  return r satisfies InviteCreated
})
