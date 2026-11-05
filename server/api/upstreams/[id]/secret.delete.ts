import { getRuntime } from '../../../gateway/runtime'
import * as svc from '../../../gateway/service'
import { noContent, noStore } from '../../../utils/api'
import { requireUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  const q = getQuery(event)
  const kind = typeof q.kind === 'string' ? q.kind : ''
  const name = typeof q.name === 'string' ? q.name : ''
  await svc.deleteSecret(rt, who, getRouterParam(event, 'id') ?? '', kind, kind === 'env' ? name : kind === 'header' ? (await svc.getUpstream(rt, who, getRouterParam(event, 'id') ?? '')).authHeaderName ?? '' : '')
  return noContent(event)
})
