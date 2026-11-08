import { eq, and } from 'drizzle-orm'
import { getAuth } from '../../auth'
import { getDb } from '../../db'
import { account } from '../../db/schema'
import { getRuntime } from '../../gateway/runtime'
import * as svc from '../../gateway/service'
import { apiError, noStore, readObject } from '../../utils/api'
import { clientIp } from '../../utils/client-ip'
import { allowRequest } from '../../utils/ip-limit'
import { requireUser } from '../../utils/session'

/** Delete the own account. Needs the current password and the literal e-mail address; 204 on success, the session is gone with the user. */
export default defineEventHandler(async (event) => {
  const { user } = await requireUser(event)
  noStore(event)
  // Password guessing protection beyond the session: few attempts per IP and per user
  const ip = clientIp(event) ?? 'unknown'
  if (!allowRequest(ip, 'me-delete', 5, 15 * 60_000) || !allowRequest(user.id, 'me-delete-user', 5, 15 * 60_000)) throw apiError(429, 'rate_limited', 'Zu viele Versuche')
  const body = await readObject(event)
  const db = await getDb()
  const auth = await getAuth()
  const verify = async (password: string) => {
    const [acc] = await db.select({ hash: account.password }).from(account).where(and(eq(account.userId, user.id), eq(account.providerId, 'credential'))).limit(1)
    if (!acc?.hash) return false
    return await (await auth.$context).password.verify({ hash: acc.hash, password })
  }
  await svc.selfDelete(await getRuntime(), { id: user.id, role: user.role === 'admin' ? 'admin' : 'user', email: user.email }, body, verify)
  setResponseStatus(event, 204)
  return null
})
