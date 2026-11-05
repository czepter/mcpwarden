import { getAuth } from '../../auth'
import { withMutex } from '../../utils/mutex'

export default defineEventHandler(async (event) => {
  const auth = await getAuth()
  const req = toWebRequest(event)
  // Sign-up im Mutex: "zaehlen, pruefen, anlegen" ist atomar (zwei Erstregistrierungen ergeben nie zwei Admins).
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/sign-up/email')) {
    return withMutex(() => auth.handler(req))
  }
  return auth.handler(req)
})
