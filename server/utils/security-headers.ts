import { createHash } from 'node:crypto'

/**
 * Response security headers (audit: no CSP / frame-ancestors / nosniff / Referrer-Policy was set anywhere).
 *
 * - Every response: `nosniff`, `Referrer-Policy: same-origin` (consent/device URLs carry OAuth query parameters that must not
 *   leak to other origins), `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, and HSTS when `BASE_URL` is https.
 * - API-like responses (JSON, discovery, health): CSP `default-src 'none'; frame-ancestors 'none'`.
 * - HTML pages: a CSP that allows only same-origin resources plus the inline scripts of THAT response by SHA-256 hash.
 *   Nuxt emits inline scripts (runtime config, the theme-before-paint script) whose content can differ per instance, so
 *   hashes are computed from the rendered HTML instead of allowing `'unsafe-inline'` for scripts.
 *   Styles keep `'unsafe-inline'` (Vue/Tailwind inline style bindings); that does not allow script execution.
 */

export function baseSecurityHeaders(o: { https: boolean }): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
    ...(o.https ? { 'strict-transport-security': 'max-age=31536000' } : {}),
  }
}

/** CSP for responses that are not pages (JSON, discovery documents, health): nothing may load or frame them. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"

/** Paths whose responses are data, not pages. */
export const isApiPath = (path: string): boolean =>
  path.startsWith('/api/') || path === '/mcp' || path.startsWith('/.well-known/') || path === '/healthz' || path === '/readyz'

export function pageCsp(o: { scriptHashes: string[], https: boolean }): string {
  const script = ["'self'", ...o.scriptHashes.map(h => `'sha256-${h}'`)].join(' ')
  return [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(o.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ')
}

/** `type` values of inline scripts the browser executes (and therefore the CSP governs); data blocks such as JSON are not. */
const EXECUTABLE_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript', 'importmap'])

/** SHA-256 (base64) of every executable inline `<script>` in the HTML document. */
export function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>()
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const attrs = m[1] ?? ''
    if (/\bsrc\s*=/i.test(attrs)) continue
    const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
    const t = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim().toLowerCase()
    if (!EXECUTABLE_TYPES.has(t)) continue
    out.add(createHash('sha256').update(m[2] ?? '', 'utf8').digest('base64'))
  }
  return [...out]
}
