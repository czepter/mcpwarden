import { getAuth } from '../../auth'
import { dispatchAuth } from '../../utils/auth-dispatch'
import { toAuthRequest } from '../../utils/client-ip'

export default defineEventHandler(async (event) => {
  // Bounded body and the sign-up mutex live in dispatchAuth (shared with /.well-known/**).
  return dispatchAuth(await getAuth(), toAuthRequest(event))
})
