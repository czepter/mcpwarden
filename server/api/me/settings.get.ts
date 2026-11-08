import type { MeSettings } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import { noStore } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<MeSettings> => {
  const { user } = await requireUser(event)
  const rt = await getRuntime()
  noStore(event)
  const p = await rt.repo.getPrefs(user.id)
  return { notifyStatusMail: p.notifyStatusMail, notifyNewClient: p.notifyNewClient, notifyWeekly: p.notifyWeekly, theme: p.theme, toolMode: await rt.repo.getToolMode(user.id) } satisfies MeSettings
})
