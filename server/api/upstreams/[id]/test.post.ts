import type { UpstreamTestResult } from '#shared/api-types'
import { getRuntime } from '../../../gateway/runtime'
import * as svc from '../../../gateway/service'
import { noStore } from '../../../utils/api'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  return await svc.testUpstream(rt, who, getRouterParam(event, 'id') ?? '') satisfies UpstreamTestResult
})
