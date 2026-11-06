/**
 * Personal access tokens (plan 0b, task 5): generation and hash. Pure functions.
 * Only the SHA-256 hash is stored; 256 bits of randomness need no salt. Persistence follows with 0a.
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

export const PAT_MAX_DAYS = 365

export function validatePatExpiry(v: unknown): { ok: true, days: number | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, days: null }
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PAT_MAX_DAYS ? { ok: true, days: v } : { ok: false }
}

export function validatePatUpstreams(v: unknown): { ok: true, ids: string[] | null } | { ok: false } {
  if (v === undefined || v === null) return { ok: true, ids: null }
  if (!Array.isArray(v) || v.length < 1 || v.length > 100 || !v.every(x => typeof x === 'string')) return { ok: false }
  return { ok: true, ids: [...new Set(v as string[])] }
}

export function validatePatName(name: unknown): { ok: true, name: string } | { ok: false } {
  if (typeof name !== 'string') return { ok: false }
  const trimmed = name.trim()
  return trimmed.length >= 1 && trimmed.length <= PAT_NAME_MAX ? { ok: true, name: trimmed } : { ok: false }
}
