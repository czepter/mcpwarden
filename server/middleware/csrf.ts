import { apiError } from '../utils/api'
import { getConfig } from '../utils/config'
import { isCsrfViolation } from '../utils/csrf'

export default defineEventHandler((event) => {
  const h = event.node.req.headers
  if (isCsrfViolation({
    method: event.method,
    path: event.path.split('?')[0]!,
    origin: h.origin,
    secFetchSite: h['sec-fetch-site'] as string | undefined,
    hasAuthorization: !!h.authorization,
    allowedOrigins: getConfig().allowedOrigins,
  })) throw apiError(403, 'forbidden_origin', 'Anfrage von fremdem Ursprung abgelehnt')
})
