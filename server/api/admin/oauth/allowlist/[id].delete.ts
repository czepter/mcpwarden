import { removeAllowlistEntry } from '../../../../auth/dcr-store'
import { getDb } from '../../../../db'
import { apiError, noContent } from '../../../../utils/api'
import { requireAdmin } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  if (!(await removeAllowlistEntry(await getDb(), getRouterParam(event, 'id') ?? ''))) throw apiError(404, 'not_found', 'allowlist entry not found')
  return noContent(event)
})
