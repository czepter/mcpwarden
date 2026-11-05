/**
 * DCR policy and allowlist matcher (plan 0b, task 3). Pure functions, no DB, no Nitro.
 *
 * The allowlist is a convenience/warning logic, not a security feature: name and redirect pattern must
 * match together, the name alone is forgeable (risk R4).
 */
import type { DcrMode } from '../../shared/api-types'

export type AllowlistPattern = { label: string, namePattern: string, redirectPatterns: string[] }
export type RegistrationMetadata = { clientName?: string, redirectUris: string[] }

export type RegistrationDecision =
  | { allow: true, allowlisted: boolean }
  | { allow: false, allowlisted: false, status: 400 | 403, error: 'access_denied' | 'invalid_client_metadata' | 'invalid_redirect_uri', reason: string }

export const MAX_CLIENT_NAME_LENGTH = 80

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
// Schemes that never qualify as a redirect (script execution, local files).
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:'])

/**
 * Builtin preset. Patterns for the local clients follow the redirect forms from the plan
 * (loopback with any port, app schemes). The Claude web callback is UNVERIFIED
 * (check against the client docs during the spike); name patterns are assumptions and deliberately generous.
 */
export const BUILTIN_ALLOWLIST: readonly AllowlistPattern[] = [
  { label: 'Claude Code', namePattern: 'Claude Code*', redirectPatterns: ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'] },
  { label: 'Claude Desktop/Web', namePattern: 'Claude*', redirectPatterns: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'] },
  { label: 'Cursor', namePattern: 'Cursor*', redirectPatterns: ['cursor://', 'http://localhost:*', 'http://127.0.0.1:*'] },
  { label: 'VS Code', namePattern: 'Visual Studio Code*', redirectPatterns: ['vscode://', 'vscode-insiders://', 'http://localhost:*', 'http://127.0.0.1:*'] },
  { label: 'Windsurf', namePattern: 'Windsurf*', redirectPatterns: ['windsurf://', 'http://localhost:*', 'http://127.0.0.1:*'] },
  { label: 'Zed', namePattern: 'Zed*', redirectPatterns: ['zed://', 'http://localhost:*', 'http://127.0.0.1:*'] },
  { label: 'Codex', namePattern: 'Codex*', redirectPatterns: ['http://localhost:*', 'http://127.0.0.1:*'] },
] as const

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase())
}

function parse(uri: string): URL | null {
  try {
    return new URL(uri)
  } catch {
    return null
  }
}

/** App schemes allowed without an admin entry (target clients of the builtin allowlist). */
export const DEFAULT_APP_SCHEMES: readonly string[] = ['cursor', 'vscode', 'vscode-insiders', 'windsurf', 'zed']

/** App schemes registered by the admin: schemes of all non-http(s) redirect patterns of the allowlist. */
export function registeredAppSchemes(allowlist: readonly AllowlistPattern[]): string[] {
  const out = new Set<string>()
  for (const e of allowlist) {
    for (const p of e.redirectPatterns) {
      const m = /^([a-z][a-z0-9+.-]*):\/\//i.exec(p)
      if (m && !['http', 'https'].includes(m[1]!.toLowerCase())) out.add(m[1]!.toLowerCase())
    }
  }
  return [...out]
}

/**
 * Is the URI permissible as a redirect target (independent of the name match)? Deny by default:
 * https; http only for canonical loopback hosts; otherwise only schemes from `appSchemes`.
 */
export function checkRedirectUri(uri: string, appSchemes: readonly string[] = DEFAULT_APP_SCHEMES): { ok: true } | { ok: false, reason: string } {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048) return { ok: false, reason: 'redirect_uri has invalid length' }
  if (uri.includes('*')) return { ok: false, reason: 'wildcards are not allowed in redirect_uri' }
  const url = parse(uri)
  if (!url) return { ok: false, reason: 'redirect_uri is not a valid URI' }
  // Defence in depth; the allowlist below excludes these schemes anyway.
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return { ok: false, reason: `scheme ${url.protocol} is not allowed` }
  if (url.username || url.password || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(uri)) return { ok: false, reason: 'userinfo is not allowed in redirect_uri' }
  if (url.hash || uri.includes('#')) return { ok: false, reason: 'fragments are not allowed in redirect_uri' }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    // Reject non-canonical hosts (127.1, 2130706433, uppercase with a dot ...).
    if (!uri.toLowerCase().startsWith(url.origin.toLowerCase())) return { ok: false, reason: 'host is not in canonical form' }
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) return { ok: false, reason: 'http is only allowed for loopback hosts' }
    return { ok: true }
  }
  const scheme = url.protocol.slice(0, -1)
  return appSchemes.includes(scheme) ? { ok: true } : { ok: false, reason: `app scheme ${scheme} is not registered` }
}

export type RedirectKind = 'web' | 'loopback' | 'app'

export function redirectKind(uri: string): RedirectKind {
  const url = parse(uri)
  if (!url) return 'app'
  if (url.protocol === 'https:') return 'web'
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return 'loopback'
  return 'app'
}

/** Display: https and loopback as host, everything else with the scheme (`evil-app://claude.ai`). */
export function redirectHost(uri: string): string {
  const url = parse(uri)
  if (!url) return ''
  return redirectKind(uri) === 'app' ? `${url.protocol}//${url.host}` : url.host
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

export function matchesNamePattern(pattern: string, name: string): boolean {
  return globToRegExp(pattern).test(name)
}

/**
 * Pattern `scheme://host[:port|:*][/path]`. Host exact (never suffix), `:*` = any port,
 * no port in the pattern = default port, empty path = any, `.../*` = prefix, otherwise exact.
 * A pattern without a host (`cursor://`) matches any URI of this scheme.
 */
export function matchesRedirectPattern(pattern: string, uri: string): boolean {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/:]*|\[[^\]]*\])(?::(\*|\d+))?(\/.*)?$/i.exec(pattern)
  const url = parse(uri)
  if (!m || !url) return false
  const [, scheme, host, port, path] = m
  if (url.protocol !== `${scheme!.toLowerCase()}:`) return false
  if (host) {
    if (url.hostname.toLowerCase() !== host.toLowerCase()) return false
    if (port !== '*' && (port ?? '') !== url.port) return false
  } else if (port) {
    return false
  }
  if (!path) return true
  if (path.endsWith('/*')) return url.pathname.startsWith(path.slice(0, -1))
  return url.pathname === path
}

/** Name AND all redirect URIs must match. */
export function matchesAllowlist(entry: AllowlistPattern, name: string, redirectUris: string[]): boolean {
  if (redirectUris.length === 0) return false
  if (!matchesNamePattern(entry.namePattern, name)) return false
  return redirectUris.every(uri => entry.redirectPatterns.some(p => matchesRedirectPattern(p, uri)))
}

export function isAllowlisted(allowlist: readonly AllowlistPattern[], name: string, redirectUris: string[]): boolean {
  return allowlist.some(e => matchesAllowlist(e, name, redirectUris))
}

/** `client_name` is untrusted: strip control characters, truncate to 80 characters. */
export function sanitizeClientName(name: unknown): string {
  // eslint-disable-next-line no-control-regex
  const clean = (typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return clean.length > MAX_CLIENT_NAME_LENGTH ? `${clean.slice(0, MAX_CLIENT_NAME_LENGTH - 1)}…` : clean
}

export function evaluateRegistration(mode: DcrMode, allowlist: readonly AllowlistPattern[], metadata: RegistrationMetadata): RegistrationDecision {
  if (mode === 'off') {
    return { allow: false, allowlisted: false, status: 403, error: 'access_denied', reason: 'dynamic client registration is disabled' }
  }
  if (metadata.redirectUris.length === 0) {
    return { allow: false, allowlisted: false, status: 400, error: 'invalid_redirect_uri', reason: 'at least one redirect_uri is required' }
  }
  const appSchemes = [...DEFAULT_APP_SCHEMES, ...registeredAppSchemes(allowlist)]
  for (const uri of metadata.redirectUris) {
    const check = checkRedirectUri(uri, appSchemes)
    if (!check.ok) return { allow: false, allowlisted: false, status: 400, error: 'invalid_redirect_uri', reason: check.reason }
  }
  const allowlisted = isAllowlisted(allowlist, sanitizeClientName(metadata.clientName), metadata.redirectUris)
  if (mode === 'allowlist' && !allowlisted) {
    return { allow: false, allowlisted: false, status: 400, error: 'invalid_client_metadata', reason: 'client is not on the allowlist' }
  }
  return { allow: true, allowlisted }
}
