import type { AllowlistEntry } from '#shared/api-types'
import { addAllowlistEntry, validateAllowlistInput } from '../../../auth/dcr-store'
import { getDb } from '../../../db'
import { apiError, readObject } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event): Promise<AllowlistEntry> => {
  await requireAdmin(event)
  const v = validateAllowlistInput(await readObject(event))
  if (!v.ok) throw apiError(400, 'invalid_entry', `invalid value for ${v.field}`, v.field)
  const entry = await addAllowlistEntry(await getDb(), v.value)
  setResponseStatus(event, 201)
  return entry satisfies AllowlistEntry
})
