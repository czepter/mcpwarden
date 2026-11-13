import { getAuth } from '../../auth'
import { dispatchAuth } from '../../utils/auth-dispatch'
import { toAuthRequest } from '../../utils/client-ip'

// Discovery at the root (RFC 8414 / RFC 9728). Better Auth hangs off the basePath /api/auth (issuer
// `<BASE_URL>/api/auth`), but answers the well-known paths in `onRequest` independently of it:
// we only pass the request through (no JSON built by us). Spike finding (task 1/2):
//  - /.well-known/oauth-protected-resource[/mcp]               -> answered by the plugin
//  - /.well-known/oauth-authorization-server/api/auth          -> answered by the plugin (path insertion, RFC 8414)
//  - /.well-known/oauth-authorization-server and .../openid-configuration (without a path) return 404;
//    we rewrite them to the path variant so that clients without path insertion also find them.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*',
}
const ROOT_ALIASES: Record<string, string> = {
  '/.well-known/oauth-authorization-server': '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/openid-configuration': '/api/auth/.well-known/openid-configuration',
}

export default defineEventHandler(async (event) => {
  if (event.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  let req = toAuthRequest(event)
  const url = new URL(req.url)
  const alias = ROOT_ALIASES[url.pathname]
  if (alias) req = new Request(new URL(alias, url), req)
  // Same entry as /api/auth/**: bounded body and sign-up mutex on the NORMALISED path (a dot-segment target such as
  // /.well-known/%2e%2e/api/auth/sign-up/email must not skip the lock).
  const res = await dispatchAuth(await getAuth(), req)
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
})
