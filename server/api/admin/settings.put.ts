import type { AdminSettingsResult } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import * as svc from '../../gateway/service'
import { noStore, readObject } from '../../utils/api'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdmin(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  return await svc.putSettings(rt, who, await readObject(event)) satisfies AdminSettingsResult
})
