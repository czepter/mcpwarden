import { getAuth } from '../../auth'
import { toAuthRequest } from '../../utils/client-ip'
import { withMutex } from '../../utils/mutex'

export default defineEventHandler(async (event) => {
  const auth = await getAuth()
  const req = toAuthRequest(event)
  // Sign-up in the mutex: "count, check, create" is atomic (two first registrations never yield two admins).
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/sign-up/email')) {
    return withMutex(() => auth.handler(req))
  }
  return auth.handler(req)
})
