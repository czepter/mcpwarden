import type { InviteInfo } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import * as svc from '../../gateway/service'
import { apiError, noStore } from '../../utils/api'
import { allowRequest } from '../../utils/ip-limit'

/** Öffentlich: gibt nur Gültigkeit, gebundene Adresse und Ablauf preis. Rate-Limit je IP gegen Token-Raten. */
export default defineEventHandler(async (event): Promise<InviteInfo> => {
  noStore(event)
  if (!allowRequest(getRequestIP(event, { xForwardedFor: false }) ?? 'unknown', 'invite-info', 30, 60_000)) throw apiError(429, 'rate_limited', 'Zu viele Anfragen')
  return await svc.inviteInfo(await getRuntime(), getRouterParam(event, 'token') ?? '') satisfies InviteInfo
})
