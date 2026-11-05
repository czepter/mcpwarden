import type { MeSettings } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import { apiError, noStore, readObject } from '../../utils/api'
import { requireUser } from '../../utils/session'

export default defineEventHandler(async (event): Promise<MeSettings> => {
  const { user } = await requireUser(event)
  const body = await readObject(event)
  const unknown = Object.keys(body).filter(k => k !== 'notifyStatusMail')
  if (unknown.length) throw apiError(422, 'validation', 'Unbekanntes Feld', unknown[0])
  if (body.notifyStatusMail !== undefined && typeof body.notifyStatusMail !== 'boolean') throw apiError(422, 'validation', 'notifyStatusMail muss true oder false sein', 'notifyStatusMail')
  const rt = await getRuntime()
  noStore(event)
  if (typeof body.notifyStatusMail === 'boolean') await rt.repo.setNotifyStatusMail(user.id, body.notifyStatusMail)
  return { notifyStatusMail: await rt.repo.getNotifyStatusMail(user.id) } satisfies MeSettings
})
