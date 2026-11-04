/**
 * Discovery-Dokumente (RFC 9728) und Origin-Pruefung fuer /mcp (Plan 0b, Aufgabe 2 und 7).
 * URLs kommen immer aus BASE_URL, nie aus Host- oder X-Forwarded-Headern.
 */
import { hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server'
import { SCOPES_SUPPORTED } from '../auth/scopes'

export function resourceUrl(baseUrl: URL): string {
  return new URL('/mcp', baseUrl).href
}

export function resourceMetadataUrl(baseUrl: URL): string {
  return new URL('/.well-known/oauth-protected-resource/mcp', baseUrl).href
}

/** `issuer` ist die Issuer-URL des Better-Auth-Providers (Spike Aufgabe 1 legt sie fest). */
export function protectedResourceMetadata(baseUrl: URL, issuer: string) {
  return {
    resource: resourceUrl(baseUrl),
    authorization_servers: [issuer],
    scopes_supported: [...SCOPES_SUPPORTED],
    bearer_methods_supported: ['header'],
    resource_name: 'mcpwarden',
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': '*',
}

/** Oeffentliche Metadaten: GET liefert JSON mit offenem CORS, OPTIONS 204, sonst 405. */
export function wellKnownResponse(request: Request, body: unknown): Response {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { ...CORS, allow: 'GET, OPTIONS' } })
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } })
}

/**
 * Origin-Pruefung (Gate Schritt a). Der SDK-Helfer vergleicht nur Hostnamen (ohne Port); fehlender
 * `Origin` (CLI-Clients) passiert. Zusaetzlich Host-Header gegen den Host aus BASE_URL (DNS-Rebinding).
 * Liefert eine 403-Antwort oder `undefined`.
 */
export function checkOrigin(request: Request, cfg: { baseUrl: URL, allowedOrigins: string[] }): Response | undefined {
  const hostnames = new Set<string>([cfg.baseUrl.hostname])
  for (const o of cfg.allowedOrigins) {
    try {
      hostnames.add(new URL(o).hostname)
    } catch { /* ungueltige Eintraege faengt getConfig ab */ }
  }
  return originValidationResponse(request, [...hostnames]) ?? hostHeaderValidationResponse(request, [cfg.baseUrl.hostname])
}
