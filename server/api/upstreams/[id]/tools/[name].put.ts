import type { UpstreamToolItem } from '#shared/api-types'
import { getRuntime } from '../../../../gateway/runtime'
import * as svc from '../../../../gateway/service'
import { noStore, readObject } from '../../../../utils/api'
import { requireUser } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  const body = await readObject(event)
  return await svc.setToolEnabled(rt, who, getRouterParam(event, 'id') ?? '', getRouterParam(event, 'name') ?? '', body.enabled) satisfies UpstreamToolItem
})
