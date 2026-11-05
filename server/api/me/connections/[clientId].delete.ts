import { revokeConnection } from '../../../auth/pat-store'
import { getDb } from '../../../db'
import { closeUserStreams } from '../../../mcp/notify'
import { apiError, noContent } from '../../../utils/api'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  if (!(await revokeConnection(await getDb(), user.id, getRouterParam(event, 'clientId') ?? ''))) throw apiError(404, 'not_found', 'client connection not found')
  await closeUserStreams(user.id)
  return noContent(event)
})
