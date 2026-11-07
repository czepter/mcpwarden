import { getRuntime } from '../../gateway/runtime'
import * as svc from '../../gateway/service'
import { noStore } from '../../utils/api'
import { requireUser } from '../../utils/session'

/**
 * Browser redirect target of the upstream's authorization server. Always answers with a redirect back into the UI; the outcome
 * travels as `?oauth=ok|denied|error` (never a code, state or error text).
 */
export default defineEventHandler(async (event) => {
  noStore(event)
  let user
  try { user = (await requireUser(event)).user } catch { return sendRedirect(event, '/login?redirect=%2Fupstreams', 302) }
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const q = getQuery(event)
  const s = (k: string) => (typeof q[k] === 'string' ? q[k] as string : undefined)
  const r = await svc.completeUpstreamOAuth(await getRuntime(), who, { state: s('state'), code: s('code'), iss: s('iss'), error: s('error') })
  return sendRedirect(event, r.upstreamId ? `/upstreams/${r.upstreamId}?tab=auth&oauth=${r.result}` : `/upstreams?oauth=${r.result}`, 302)
})
