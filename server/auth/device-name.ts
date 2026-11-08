/** Device labels for OAuth connections and PATs: untrusted user input, sanitised; the guess from the User-Agent keeps only OS and browser family. */
import { and, eq } from 'drizzle-orm'
import type { Db } from '../db'
import { oauthConsent } from '../db/schema/auth'
import { oauthConnectionDevice, personalAccessToken } from '../db/schema/mcp'
import { UUID_RE } from './dcr-store'

export const DEVICE_NAME_MAX = 64

/** Trim, drop control, bidi and zero-width characters, collapse whitespace. `null` = empty (no label); `undefined` = not a string. */
export function sanitizeDeviceName(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim()
  if (clean.length > DEVICE_NAME_MAX) return undefined
  return clean === '' ? null : clean
}

/** "Mac · Safari" style from a User-Agent. Only coarse families, never the version or the raw string. `null` when nothing is recognisable. */
export function guessDeviceName(ua: unknown): string | null {
  if (typeof ua !== 'string' || ua === '') return null
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux|X11/.test(ua) ? 'Linux' : null
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null
  const parts = [os, browser].filter((p): p is string => !!p)
  return parts.length ? parts.join(' · ') : null
}

/** Upsert or (name = null) delete the label of this user's connection with the client. */
export async function setConnectionDevice(db: Db, userId: string, clientId: string, name: string | null): Promise<void> {
  if (name === null) {
    await db.delete(oauthConnectionDevice).where(and(eq(oauthConnectionDevice.userId, userId), eq(oauthConnectionDevice.clientId, clientId)))
    return
  }
  await db.insert(oauthConnectionDevice).values({ userId, clientId, deviceName: name, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [oauthConnectionDevice.userId, oauthConnectionDevice.clientId], set: { deviceName: name, updatedAt: new Date() } })
}

/** `false` = the user has no consent with this client (nothing to rename). */
export async function renameConnection(db: Db, userId: string, clientId: string, name: string | null): Promise<boolean> {
  const own = await db.select({ id: oauthConsent.id }).from(oauthConsent).where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))).limit(1)
  if (own.length === 0) return false
  await setConnectionDevice(db, userId, clientId, name)
  return true
}

/** `false` = PAT does not belong to this user / does not exist. */
export async function renamePat(db: Db, userId: string, id: string, name: string | null): Promise<boolean> {
  if (!UUID_RE.test(id)) return false
  const r = await db.update(personalAccessToken).set({ deviceName: name }).where(and(eq(personalAccessToken.id, id), eq(personalAccessToken.userId, userId))).returning({ id: personalAccessToken.id })
  return r.length > 0
}
