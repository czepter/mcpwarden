import type { OAuthClientAdmin } from '#shared/api-types'
import { consentUserIds, getAdminClient, setClientDisabled } from '../../../../auth/dcr-store'
import { getDb } from '../../../../db'
import { closeUserStreams } from '../../../../mcp/notify'
import { apiError, readObject } from '../../../../utils/api'
import { requireAdmin } from '../../../../utils/session'

export default defineEventHandler(async (event): Promise<OAuthClientAdmin> => {
  await requireAdmin(event)
  const id = getRouterParam(event, 'id') ?? ''
  const { disabled } = await readObject(event)
  if (typeof disabled !== 'boolean') throw apiError(400, 'invalid_body', 'disabled must be a boolean', 'disabled')
  const db = await getDb()
  if (!(await setClientDisabled(db, id, disabled))) throw apiError(404, 'not_found', 'client not found')
  // Offene Listen-Streams der Nutzer dieses Clients enden sofort; der Guard lehnt den naechsten Request ohnehin ab.
  if (disabled) await Promise.all((await consentUserIds(db, id)).map(closeUserStreams))
  return (await getAdminClient(db, id))! satisfies OAuthClientAdmin
})
