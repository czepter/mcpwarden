import type { H3Event } from 'h3'
import { getAuth } from '../auth'
import { isBanned } from '../auth/access-guard'
import { apiError } from './api'

async function load(event: H3Event) {
  const auth = await getAuth()
  const s = await auth.api.getSession({ headers: event.headers })
  if (!s) throw apiError(401, 'unauthorized', 'not signed in')
  return s
}

/** Angemeldeter Nutzer oder 401. */
export async function requireUser(event: H3Event) {
  const s = await load(event)
  // Eine abgelaufene Sperre (banExpires) zaehlt nicht mehr, wie beim /mcp-Zugriffs-Check
  if (isBanned({ id: s.user.id, role: s.user.role === 'admin' ? 'admin' : 'user', banned: s.user.banned === true, banExpires: s.user.banExpires ? new Date(s.user.banExpires) : null }, new Date())) throw apiError(403, 'forbidden', 'account is banned')
  return s
}

/** Admin ohne Sperre oder 401/403. */
export async function requireAdmin(event: H3Event) {
  const s = await requireUser(event)
  if (s.user.role !== 'admin') throw apiError(403, 'forbidden', 'admin only')
  return s
}
