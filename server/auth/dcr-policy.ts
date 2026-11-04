/**
 * DCR-Policy und Allowlist-Matcher (Plan 0b, Aufgabe 3). Reine Funktionen, keine DB, kein Nitro.
 *
 * Allowlist ist Komfort/Warnlogik, kein Sicherheitsmerkmal: Name und Redirect-Muster muessen
 * gemeinsam passen, der Name allein ist faelschbar (Risiko R4).
 */
import type { DcrMode } from '../../shared/api-types'

export type AllowlistPattern = { label: string, namePattern: string, redirectPatterns: string[] }
export type RegistrationMetadata = { clientName?: string, redirectUris: string[] }

export type RegistrationDecision =
  | { allow: true, allowlisted: boolean }
  | { allow: false, allowlisted: false, status: 400 | 403, error: 'access_denied' | 'invalid_client_metadata' | 'invalid_redirect_uri', reason: string }

export const MAX_CLIENT_NAME_LENGTH = 80

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
// Schemes, die als Redirect nie in Frage kommen (Skriptausfuehrung, lokale Dateien).
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:'])

/**
 * Builtin-Vorbelegung. Muster fuer die lokalen Clients folgen den Redirect-Formen aus dem Plan
 * (Loopback mit beliebigem Port, App-Schemes). Claude-Web-Callback ist UNVERIFIZIERT
 * (beim Spike gegen die Client-Doku pruefen); Namensmuster sind Annahmen und bewusst grosszuegig.
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

/** App-Schemes, die ohne Admin-Eintrag erlaubt sind (Zielclients der Builtin-Allowlist). */
export const DEFAULT_APP_SCHEMES: readonly string[] = ['cursor', 'vscode', 'vscode-insiders', 'windsurf', 'zed']

/** Vom Admin registrierte App-Schemes: Schemes aller Nicht-http(s)-Redirect-Muster der Allowlist. */
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
 * Ist die URI als Redirect-Ziel zulaessig (unabhaengig vom Namens-Match)? Deny-by-default:
 * https; http nur fuer kanonische Loopback-Hosts; sonst nur Schemes aus `appSchemes`.
 */
export function checkRedirectUri(uri: string, appSchemes: readonly string[] = DEFAULT_APP_SCHEMES): { ok: true } | { ok: false, reason: string } {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048) return { ok: false, reason: 'redirect_uri has invalid length' }
  if (uri.includes('*')) return { ok: false, reason: 'wildcards are not allowed in redirect_uri' }
  const url = parse(uri)
  if (!url) return { ok: false, reason: 'redirect_uri is not a valid URI' }
  // Defence in depth; die Allowlist unten schliesst diese Schemes ohnehin aus.
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return { ok: false, reason: `scheme ${url.protocol} is not allowed` }
  if (url.username || url.password || /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(uri)) return { ok: false, reason: 'userinfo is not allowed in redirect_uri' }
  if (url.hash || uri.includes('#')) return { ok: false, reason: 'fragments are not allowed in redirect_uri' }
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    // Nicht-kanonische Hosts (127.1, 2130706433, Grossschreibung mit Punkt ...) abweisen.
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

/** Anzeige: https und Loopback als Host, alles andere mit Scheme (`evil-app://claude.ai`). */
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
 * Muster `scheme://host[:port|:*][/pfad]`. Host exakt (nie Suffix), `:*` = beliebiger Port,
 * kein Port im Muster = Standardport, Pfad leer = beliebig, `.../*` = Praefix, sonst exakt.
 * Muster ohne Host (`cursor://`) passt auf jede URI dieses Schemes.
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

/** Name UND alle Redirect-URIs muessen passen. */
export function matchesAllowlist(entry: AllowlistPattern, name: string, redirectUris: string[]): boolean {
  if (redirectUris.length === 0) return false
  if (!matchesNamePattern(entry.namePattern, name)) return false
  return redirectUris.every(uri => entry.redirectPatterns.some(p => matchesRedirectPattern(p, uri)))
}

export function isAllowlisted(allowlist: readonly AllowlistPattern[], name: string, redirectUris: string[]): boolean {
  return allowlist.some(e => matchesAllowlist(e, name, redirectUris))
}

/** `client_name` ist untrusted: Steuerzeichen raus, auf 80 Zeichen kuerzen. */
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
