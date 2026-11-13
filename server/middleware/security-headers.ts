import { getConfig } from '../utils/config'
import { API_CSP, baseSecurityHeaders, isApiPath } from '../utils/security-headers'

// Headers for every response; the page CSP (with per-response script hashes) is added by plugins/40-security-headers.ts.
export default defineEventHandler((event) => {
  const https = getConfig().baseUrl.protocol === 'https:'
  setResponseHeaders(event, baseSecurityHeaders({ https }))
  if (isApiPath(event.path.split('?')[0]!)) setResponseHeader(event, 'content-security-policy', API_CSP)
})
