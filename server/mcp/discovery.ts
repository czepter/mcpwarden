/**
 * URLs and origin check for /mcp (plan 0b, tasks 2 and 7). The discovery documents themselves are served by the
 * plugin (routes/.well-known/[...path].ts passes through).
 * URLs always come from BASE_URL, never from Host or X-Forwarded headers.
 */
import { hostHeaderValidationResponse, originValidationResponse } from '@modelcontextprotocol/server'

export function resourceUrl(baseUrl: URL): string {
  return new URL('/mcp', baseUrl).href
}

export function resourceMetadataUrl(baseUrl: URL): string {
  return new URL('/.well-known/oauth-protected-resource/mcp', baseUrl).href
}

/**
 * Origin check (gate step a). The SDK helper compares only hostnames (without port); a missing
 * `Origin` (CLI clients) passes. Additionally the Host header against the host from BASE_URL (DNS rebinding).
 * Returns a 403 response or `undefined`.
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
