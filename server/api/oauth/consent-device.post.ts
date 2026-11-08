import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { eq } from 'drizzle-orm'
import { sanitizeDeviceName, setConnectionDevice } from '../../auth/device-name'
import { getDb } from '../../db'
import { oauthClient } from '../../db/schema/auth'
import { apiError, noContent, noStore, readObject } from '../../utils/api'
import { getConfig } from '../../utils/config'
import { requireUser } from '../../utils/session'

// The consent page stores the device label chosen by the user just before it accepts. The client comes from the signed consent query
// (same verification as consent-info), so only clients of a real authorization request can be labelled; the row belongs to the session user.
export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  noStore(event)
  const body = await readObject(event)
  const raw = typeof body.oauth_query === 'string' ? body.oauth_query.replace(/^\?/, '') : ''
  if (!raw || !(await verifyOAuthQueryParams(raw, getConfig().betterAuthSecret).catch(() => false))) throw apiError(400, 'invalid_consent_query', 'the consent query is invalid or expired')
  const name = sanitizeDeviceName(body.deviceName)
  if (name === undefined) throw apiError(400, 'invalid_device_name', 'deviceName must be at most 64 characters', 'deviceName')
  const clientId = new URLSearchParams(raw).get('client_id') ?? ''
  const db = await getDb()
  const [client] = await db.select({ id: oauthClient.clientId }).from(oauthClient).where(eq(oauthClient.clientId, clientId))
  if (!client) throw apiError(404, 'client_not_found', 'client not found')
  await setConnectionDevice(db, user.id, clientId, name)
  return noContent(event)
})
