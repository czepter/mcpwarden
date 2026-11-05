import { revokePat } from '../../../auth/pat-store'
import { getDb } from '../../../db'
import { closeUserStreams } from '../../../mcp/notify'
import { apiError, noContent } from '../../../utils/api'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  if (!(await revokePat(await getDb(), user.id, getRouterParam(event, 'id') ?? ''))) throw apiError(404, 'not_found', 'token not found')
  await closeUserStreams(user.id) // open list streams end; the guard rejects the PAT immediately anyway
  return noContent(event)
})
