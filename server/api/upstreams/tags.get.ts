import type { UpstreamTagList } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import { listTags } from '../../gateway/service'
import { noStore } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const rt = await getRuntime()
  noStore(event)
  return await listTags(rt, user.id) satisfies UpstreamTagList
})
