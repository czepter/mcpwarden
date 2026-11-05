import type { InviteCreated } from '#shared/api-types'
import { getRuntime } from '../../../gateway/runtime'
import * as svc from '../../../gateway/service'
import { noStore, readObject } from '../../../utils/api'
import { requireAdmin } from '../../../utils/session'
import { getConfig } from '../../../utils/config'
import { getMailer } from '../../../mail'

export default defineEventHandler(async (event) => {
  const { user } = await requireAdmin(event)
  const who = { id: user.id, role: (user.role === 'admin' ? 'admin' : 'user') as 'admin' | 'user' }
  const rt = await getRuntime()
  noStore(event)
  const body = await readObject(event)
  const r = await svc.adminCreateInvite(rt, who, getConfig().baseUrl, body.email, { sendMail: body.sendMail, mailer: getMailer() })
  setResponseStatus(event, 201)
  return r satisfies InviteCreated
})
