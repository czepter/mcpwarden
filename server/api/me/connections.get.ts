import type { ConnectionList } from '#shared/api-types'
import { listConnections } from '../../auth/pat-store'
import { getDb } from '../../db'
import { noStore } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<ConnectionList> => {
  const { user } = await requireUser(event)
  noStore(event)
  return { items: await listConnections(await getDb(), user.id, new Date()) } satisfies ConnectionList
})
