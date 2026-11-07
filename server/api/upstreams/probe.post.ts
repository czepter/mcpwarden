import type { UpstreamAuthProbe } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import * as svc from '../../gateway/service'
import { noStore, readObject } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireUser(event)
  const rt = await getRuntime()
  noStore(event)
  return await svc.probeUpstreamAuth(rt, (await readObject(event)).url) satisfies UpstreamAuthProbe
})
