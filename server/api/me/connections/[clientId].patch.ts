import type { PatDeviceInput } from '#shared/api-types'
import { renameConnection, sanitizeDeviceName } from '../../../auth/device-name'
import { getDb } from '../../../db'
import { apiError, noContent, noStore, readObject } from '../../../utils/api'
import { requireUser } from '../../../utils/session'

// Rename the device label of an own connection (`null` or empty clears it). Other users' connections yield 404.
export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  noStore(event)
  const body = await readObject(event) as Partial<PatDeviceInput>
  const name = sanitizeDeviceName(body.deviceName)
  if (name === undefined) throw apiError(400, 'invalid_device_name', 'deviceName must be at most 64 characters', 'deviceName')
  if (!(await renameConnection(await getDb(), user.id, getRouterParam(event, 'clientId') ?? '', name))) throw apiError(404, 'not_found', 'connection not found')
  return noContent(event)
})
