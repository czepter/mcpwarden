import type { MeSettings, ThemePreference } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import { apiError, noStore, readObject } from '../../utils/api'
import { requireUser } from '../../utils/session'

const BOOLEANS = ['notifyStatusMail', 'notifyNewClient', 'notifyWeekly'] as const
const THEMES: ThemePreference[] = ['system', 'light', 'dark']
const KNOWN: string[] = [...BOOLEANS, 'theme', 'toolMode']

export default defineEventHandler(async (event): Promise<MeSettings> => {
  const { user } = await requireUser(event)
  const body = await readObject(event)
  const unknown = Object.keys(body).filter(k => !KNOWN.includes(k))
  if (unknown.length) throw apiError(422, 'validation', 'Unbekanntes Feld', unknown[0])
  for (const k of BOOLEANS) if (body[k] !== undefined && typeof body[k] !== 'boolean') throw apiError(422, 'validation', `${k} muss true oder false sein`, k)
  if (body.theme !== undefined && !THEMES.includes(body.theme as ThemePreference)) throw apiError(422, 'validation', 'theme muss system, light oder dark sein', 'theme')
  if (body.toolMode !== undefined && body.toolMode !== 'direct' && body.toolMode !== 'meta') throw apiError(422, 'validation', 'toolMode muss direct oder meta sein', 'toolMode')
  const rt = await getRuntime()
  noStore(event)
  if (typeof body.notifyStatusMail === 'boolean') await rt.repo.setNotifyStatusMail(user.id, body.notifyStatusMail)
  const rest = {
    ...(typeof body.notifyNewClient === 'boolean' ? { notifyNewClient: body.notifyNewClient } : {}),
    ...(typeof body.notifyWeekly === 'boolean' ? { notifyWeekly: body.notifyWeekly } : {}),
    ...(body.theme !== undefined ? { theme: body.theme as ThemePreference } : {}),
  }
  if (body.toolMode === 'direct' || body.toolMode === 'meta') await rt.repo.setToolMode(user.id, body.toolMode)
  if (Object.keys(rest).length) await rt.repo.patchPrefs(user.id, rest)
  const p = await rt.repo.getPrefs(user.id)
  return { notifyStatusMail: p.notifyStatusMail, notifyNewClient: p.notifyNewClient, notifyWeekly: p.notifyWeekly, theme: p.theme, toolMode: await rt.repo.getToolMode(user.id) } satisfies MeSettings
})
