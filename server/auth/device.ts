/**
 * Device authorization grant (RFC 8628) for headless sessions: Better Auth's `oauthDeviceAuthorization()` runs the
 * protocol (code issuing, polling, one-time consumption); this file holds the mcpwarden rules around it.
 *
 *  - Only ONE client may use the grant: the first-party public client `mcpwarden-cli`, seeded at startup. A DCR client with an
 *    arbitrary name could otherwise show up on the approval page and phish a user. DCR may not register the grant either.
 *  - Required scopes and the default resource are written to the stored request right after `/device/code` (like
 *    `oauthRequestRewrite` does on `/oauth2/authorize`): every token is a JWT for `<BASE_URL>/mcp` with a refresh token. A `before`
 *    rewrite does not work here: for form bodies the plugin re-reads `scope` from the raw request and discards it.
 *  - The plugin creates no `oauth_consent` row on approval, but the access guard requires one (revocation works by deleting it):
 *    `consentOnApprove` writes it right after `/device/approve`.
 */
import { randomUUID } from 'node:crypto'
import { APIError } from 'better-auth/api'
import type { Db } from '../db'
import { oauthClient, oauthClientResource, oauthResource } from '../db/schema/auth'
import { oauthClientMeta } from '../db/schema/mcp'
import { SCOPES_SUPPORTED } from './scopes'

export const DEVICE_CLIENT_ID = 'mcpwarden-cli'
export const DEVICE_CLIENT_NAME = 'mcpwarden CLI'
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
export const DEVICE_CODE_PATH = '/device/code'
export const DEVICE_APPROVE_PATH = '/device/approve'
export const DEVICE_CODE_TTL = '10m'
export const DEVICE_POLL_INTERVAL = '5s'
export const USER_CODE_LENGTH = 8

/**
 * Idempotent. Never overwrites an existing row, so an admin who disabled the client keeps it disabled.
 * `resource` = `<BASE_URL>/mcp`: the client must be linked to it (DCR clients are linked by the plugin), otherwise `/device/code` answers
 * `invalid_target`. The resource row is inserted insert-only; the plugin's own seeding leaves an existing row alone.
 */
export async function seedDeviceClient(db: Db, resource: string): Promise<void> {
  const now = new Date()
  const [row] = await db.insert(oauthClient).values({
    id: randomUUID(),
    clientId: DEVICE_CLIENT_ID,
    name: DEVICE_CLIENT_NAME,
    scopes: [...SCOPES_SUPPORTED],
    redirectUris: [],
    tokenEndpointAuthMethod: 'none',
    grantTypes: [DEVICE_GRANT, 'refresh_token'],
    responseTypes: [],
    applicationType: 'native',
    skipConsent: false,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing().returning({ clientId: oauthClient.clientId })
  // 'admin' rows are exempt from the unused-client expiry.
  if (row) await db.insert(oauthClientMeta).values({ clientId: DEVICE_CLIENT_ID, allowlisted: true, registeredVia: 'admin' }).onConflictDoNothing()
  await db.insert(oauthResource).values({ id: randomUUID(), identifier: resource, name: resource, createdAt: now, updatedAt: now }).onConflictDoNothing()
  await db.insert(oauthClientResource).values({ id: randomUUID(), clientId: DEVICE_CLIENT_ID, resourceId: resource, createdAt: now }).onConflictDoNothing()
}

/** `onDeviceAuthRequest`: a device code is issued for the first-party client only. */
export function assertDeviceClient(clientId: string): void {
  if (clientId !== DEVICE_CLIENT_ID) throw new APIError('BAD_REQUEST', { error: 'unauthorized_client', error_description: 'client is not allowed to use the device grant' })
}

/** DCR must not hand out the device grant (see above). Returns an RFC 7591 error message or `undefined`. */
export function deviceGrantInRegistration(body: unknown): string | undefined {
  const g = (body as { grant_types?: unknown } | null)?.grant_types
  return Array.isArray(g) && g.includes(DEVICE_GRANT) ? 'the device grant cannot be registered dynamically' : undefined
}

type Adapter = {
  findOne<T>(a: { model: string, where: { field: string, value: unknown }[] }): Promise<T | null>
  create(a: { model: string, data: Record<string, unknown> }): Promise<unknown>
  update(a: { model: string, where: { field: string, value: unknown }[], update: Record<string, unknown> }): Promise<unknown>
}

/** After a successful `/device/code`: the stored request always carries all required scopes and the `/mcp` resource, whatever the client asked for. */
export async function fillDeviceDefaults(adapter: Adapter, returned: unknown, resource: string): Promise<void> {
  const deviceCode = (returned as { device_code?: unknown } | null)?.device_code
  if (typeof deviceCode !== 'string') return
  await adapter.update({ model: 'deviceCode', where: [{ field: 'deviceCode', value: deviceCode }], update: { scope: SCOPES_SUPPORTED.join(' '), resources: [resource] } })
}

type DeviceRecord = { status: string, userId: string | null, clientId: string | null, scope: string | null, resources: string[] | null }

/**
 * After a successful `/device/approve`: records consent for (user, client) so that the access guard accepts the tokens
 * and `DELETE /api/me/connections/:clientId` revokes them. Looks the request up by user code; a no-op unless it is now approved.
 */
export async function consentOnApprove(adapter: Adapter, userCode: string, now = new Date()): Promise<void> {
  const normalized = userCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  const rec = (await adapter.findOne<DeviceRecord>({ model: 'deviceCode', where: [{ field: 'userCode', value: normalized }] }))
    ?? (await adapter.findOne<DeviceRecord>({ model: 'deviceCode', where: [{ field: 'userCode', value: userCode }] }))
  if (!rec || rec.status !== 'approved' || !rec.userId || rec.clientId !== DEVICE_CLIENT_ID) return
  const scopes = (rec.scope ?? '').split(/\s+/).filter(Boolean)
  const where = [{ field: 'clientId', value: rec.clientId }, { field: 'userId', value: rec.userId }]
  const existing = await adapter.findOne<{ id: string }>({ model: 'oauthConsent', where })
  if (existing) {
    await adapter.update({ model: 'oauthConsent', where, update: { scopes, resources: rec.resources ?? undefined, updatedAt: now } })
  } else {
    await adapter.create({ model: 'oauthConsent', data: { clientId: rec.clientId, userId: rec.userId, scopes, resources: rec.resources ?? undefined, createdAt: now, updatedAt: now } })
  }
}
