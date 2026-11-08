import type { PatCreated } from '#shared/api-types'
import { validatePatExpiry, validatePatName, validatePatUpstreams } from '../../auth/pat'
import { sanitizeDeviceName } from '../../auth/device-name'
import { createPat } from '../../auth/pat-store'
import { and, eq, inArray } from 'drizzle-orm'
import { UUID_RE } from '../../auth/dcr-store'
import { getDb } from '../../db'
import { upstream } from '../../db/schema/gateway'
import { apiError, noStore, readObject } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<PatCreated> => {
  const { user } = await requireUser(event)
  noStore(event)
  const body = await readObject(event)
  const name = validatePatName(body.name)
  if (!name.ok) throw apiError(400, 'invalid_name', 'name must be 1 to 64 characters', 'name')
  const exp = validatePatExpiry(body.expiresInDays)
  if (!exp.ok) throw apiError(400, 'invalid_expiry', 'expiresInDays must be an integer from 1 to 365 or null', 'expiresInDays')
  const ups = validatePatUpstreams(body.upstreamIds)
  if (!ups.ok) throw apiError(400, 'invalid_upstreams', 'upstreamIds must be a non-empty list of upstream IDs or null', 'upstreamIds')
  const deviceName = sanitizeDeviceName(body.deviceName)
  if (deviceName === undefined) throw apiError(400, 'invalid_device_name', 'deviceName must be at most 64 characters', 'deviceName')
  const db = await getDb()
  if (ups.ids) {
    const own = await db.select({ id: upstream.id }).from(upstream).where(and(eq(upstream.userId, user.id), inArray(upstream.id, ups.ids.filter(i => UUID_RE.test(i)))))
    if (own.length !== ups.ids.length) throw apiError(400, 'invalid_upstreams', 'unknown upstream', 'upstreamIds')
  }
  const created = await createPat(db, user.id, name.name, { expiresInDays: exp.days, upstreamIds: ups.ids, deviceName })
  if (!created) throw apiError(409, 'pat_limit_reached', 'the limit of active tokens is reached')
  setResponseStatus(event, 201)
  return created satisfies PatCreated
})
