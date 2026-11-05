import type { MeSettings } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import { noStore } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<MeSettings> => {
  const { user } = await requireUser(event)
  const rt = await getRuntime()
  noStore(event)
  return { notifyStatusMail: await rt.repo.getNotifyStatusMail(user.id) } satisfies MeSettings
})
