import type { PatCreated } from '#shared/api-types'
import { validatePatName } from '../../auth/pat'
import { createPat } from '../../auth/pat-store'
import { getDb } from '../../db'
import { apiError, noStore, readObject } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<PatCreated> => {
  const { user } = await requireUser(event)
  noStore(event)
  const name = validatePatName((await readObject(event)).name)
  if (!name.ok) throw apiError(400, 'invalid_name', 'name must be 1 to 64 characters', 'name')
  const created = await createPat(await getDb(), user.id, name.name)
  if (!created) throw apiError(409, 'pat_limit_reached', 'the limit of active tokens is reached')
  setResponseStatus(event, 201)
  return created satisfies PatCreated
})
