import type { PatDeviceInput } from '#shared/api-types'
import { renamePat, sanitizeDeviceName } from '../../../auth/device-name'
import { getDb } from '../../../db'
import { apiError, noContent, noStore, readObject } from '../../../utils/api'
import { requireUser } from '../../../utils/session'

// Rename the device label of an own token (`null` or empty clears it).
export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  noStore(event)
  const body = await readObject(event) as Partial<PatDeviceInput>
  const name = sanitizeDeviceName(body.deviceName)
  if (name === undefined) throw apiError(400, 'invalid_device_name', 'deviceName must be at most 64 characters', 'deviceName')
  if (!(await renamePat(await getDb(), user.id, getRouterParam(event, 'id') ?? '', name))) throw apiError(404, 'not_found', 'token not found')
  return noContent(event)
})
