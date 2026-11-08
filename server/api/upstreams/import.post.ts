import type { UpstreamImportResult } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import { importUpstreams } from '../../gateway/import'
import { noStore, readObject } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  return await importUpstreams(rt, who, await readObject(event)) satisfies UpstreamImportResult
})
