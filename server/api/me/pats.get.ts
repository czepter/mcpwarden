import type { PatList } from '#shared/api-types'
import { listPats } from '../../auth/pat-store'
import { getDb } from '../../db'
import { noStore } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<PatList> => {
  const { user } = await requireUser(event)
  noStore(event)
  return await listPats(await getDb(), user.id) satisfies PatList
})
