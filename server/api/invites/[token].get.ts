import type { InviteInfo } from '#shared/api-types'
import { getRuntime } from '../../gateway/runtime'
import * as svc from '../../gateway/service'
import { apiError, noStore } from '../../utils/api'
import { clientIp } from '../../utils/client-ip'
import { allowRequest } from '../../utils/ip-limit'

/** Public: reveals only validity, bound address and expiry. Rate limit per IP against token guessing. */
export default defineEventHandler(async (event): Promise<InviteInfo> => {
  noStore(event)
  if (!allowRequest(clientIp(event) ?? 'unknown', 'invite-info', 30, 60_000)) throw apiError(429, 'rate_limited', 'Zu viele Anfragen')
  return await svc.inviteInfo(await getRuntime(), getRouterParam(event, 'token') ?? '') satisfies InviteInfo
})
