import type { RestToolList } from '#shared/api-types'
import { getRuntime } from '../../../gateway/runtime'
import * as rest from '../../../gateway/rest/service'
import { noStore } from '../../../utils/api'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  noStore(event)
  return await rest.listRestTools(await getRuntime(), who, getRouterParam(event, 'id') ?? '') satisfies RestToolList
})
