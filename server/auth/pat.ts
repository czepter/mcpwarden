/**
 * Personal Access Tokens (Plan 0b, Aufgabe 5): Erzeugung und Hash. Reine Funktionen.
 * Nur der SHA-256-Hash wird gespeichert; 256 Bit Zufall brauchen kein Salt. Persistenz folgt mit 0a.
 */
import { createHash, randomBytes } from 'node:crypto'

export const PAT_PREFIX = 'mcpw_pat_'
export const PAT_DISPLAY_PREFIX_LENGTH = PAT_PREFIX.length + 4 // 13
export const PAT_LIMIT = 20
export const PAT_NAME_MAX = 64

export type GeneratedPat = { token: string, hash: string, prefix: string }

export function hashPat(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isPatToken(token: string): boolean {
  return token.startsWith(PAT_PREFIX)
}

export function generatePat(): GeneratedPat {
  const token = PAT_PREFIX + randomBytes(32).toString('base64url')
  return { token, hash: hashPat(token), prefix: token.slice(0, PAT_DISPLAY_PREFIX_LENGTH) }
}

export function validatePatName(name: unknown): { ok: true, name: string } | { ok: false } {
  if (typeof name !== 'string') return { ok: false }
  const trimmed = name.trim()
  return trimmed.length >= 1 && trimmed.length <= PAT_NAME_MAX ? { ok: true, name: trimmed } : { ok: false }
}
