import type { DcrPolicy } from '#shared/api-types'
import { isDcrMode, setDcrMode } from '../../../auth/dcr-store'
import { getDb } from '../../../db'
import { apiError, readObject } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'

export default defineEventHandler(async (event): Promise<DcrPolicy> => {
  await requireAdmin(event)
  const { mode } = await readObject(event)
  if (!isDcrMode(mode)) throw apiError(400, 'invalid_mode', 'mode must be off, allowlist or open', 'mode')
  await setDcrMode(await getDb(), mode)
  return { mode } satisfies DcrPolicy
})
