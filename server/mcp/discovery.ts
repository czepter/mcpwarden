/**
 * URLs und Origin-Pruefung fuer /mcp (Plan 0b, Aufgabe 2 und 7). Die Discovery-Dokumente selbst liefert das
 * Plugin (routes/.well-known/[...path].ts reicht durch).
 * URLs kommen immer aus BASE_URL, nie aus Host- oder X-Forwarded-Headern.
 */
import { hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server'

export function resourceUrl(baseUrl: URL): string {
  return new URL('/mcp', baseUrl).href
}

export function resourceMetadataUrl(baseUrl: URL): string {
  return new URL('/.well-known/oauth-protected-resource/mcp', baseUrl).href
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
