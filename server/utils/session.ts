import { createError, type H3Event } from 'h3'
import { getAuth } from '../auth'

async function load(event: H3Event) {
  const auth = await getAuth()
  const s = await auth.api.getSession({ headers: event.headers })
  if (!s) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  return s
}

/** Angemeldeter Nutzer oder 401. */
export async function requireUser(event: H3Event) {
  const s = await load(event)
  if (s.user.banned) throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  return s
}

/** Admin ohne Sperre oder 401/403. */
export async function requireAdmin(event: H3Event) {
  const s = await requireUser(event)
  if (s.user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  return s
}
