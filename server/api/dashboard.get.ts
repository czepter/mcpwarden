import type { Dashboard } from '#shared/api-types'
import { getRuntime } from '../gateway/runtime'
import * as svc from '../gateway/service'
import { noStore } from '../utils/api'
import { requireUser } from '../utils/session'
import { listConnections } from '../auth/pat-store'
import { getDb } from '../db'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  const list = await listConnections(await getDb(), who.id, new Date())
  return await svc.dashboard(rt, who, { connections: list.map(c => ({ clientId: c.clientId, name: c.name, allowlisted: c.allowlisted, lastUsedAt: c.lastUsedAt })), window: getQuery(event).window }) satisfies Dashboard
})
