import { consentUserIds, deleteClient } from '../../../../auth/dcr-store'
import { getDb } from '../../../../db'
import { closeUserStreams } from '../../../../mcp/notify'
import { apiError, noContent } from '../../../../utils/api'
import { requireAdmin } from '../../../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  const db = await getDb()
  const users = await consentUserIds(db, id) // vor dem Loeschen (Consents verschwinden per Cascade)
  if (!(await deleteClient(db, id))) throw apiError(404, 'not_found', 'client not found')
  await Promise.all(users.map(closeUserStreams))
  return noContent(event)
})
