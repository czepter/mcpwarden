import { getAuth } from '../../auth'
import { toAuthRequest } from '../../utils/client-ip'

// Discovery im Root (RFC 8414 / RFC 9728). Better Auth haengt am basePath /api/auth (Issuer
// `<BASE_URL>/api/auth`), beantwortet die Well-known-Pfade aber in `onRequest` unabhaengig davon:
// wir reichen den Request nur durch (kein eigener JSON-Bau). Spike-Befund (Aufgabe 1/2):
//  - /.well-known/oauth-protected-resource[/mcp]               -> vom Plugin beantwortet
//  - /.well-known/oauth-authorization-server/api/auth          -> vom Plugin beantwortet (Pfad-Einfuegung, RFC 8414)
//  - /.well-known/oauth-authorization-server und .../openid-configuration (ohne Pfad) liefern 404;
//    wir schreiben sie auf die Pfadvariante um, damit auch Clients ohne Pfad-Einfuegung fuendig werden.
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
  const res = await (await getAuth()).handler(req)
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, headers })
})
