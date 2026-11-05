/** Derivations for client lists (plan 0b, assumption 13 and task 3 step 5). Pure, time injectable. */
export const ACTIVE_WINDOW_MS = 5 * 60_000
export const USE_THROTTLE_MS = 60_000
export const CLIENT_EXPIRY_MS = 30 * 24 * 3600_000

/** "Active" = last call at most 5 minutes ago. */
export function isActive(lastUsedAt: Date | null, now: Date): boolean {
  return lastUsedAt !== null && now.getTime() - lastUsedAt.getTime() <= ACTIVE_WINDOW_MS
}

/** `createdAt + 30 days` as long as the client was never used; otherwise `null`. */
export function clientExpiresAt(createdAt: Date, lastUsedAt: Date | null): string | null {
  return lastUsedAt === null ? new Date(createdAt.getTime() + CLIENT_EXPIRY_MS).toISOString() : null
}

/** Expiry task: never used and older than 30 days. */
export function isExpiredUnused(createdAt: Date, lastUsedAt: Date | null, now: Date): boolean {
  return lastUsedAt === null && now.getTime() - createdAt.getTime() > CLIENT_EXPIRY_MS
}

/** Throttling of the `last_used_at` writes: at most once per minute per key. */
export function createUseThrottle(now: () => number = Date.now) {
  const last = new Map<string, number>()
  return (key: string): boolean => {
    const t = now()
    const prev = last.get(key)
    if (prev !== undefined && t - prev < USE_THROTTLE_MS) return false
    last.set(key, t)
    if (last.size > 10_000) for (const [k, v] of last) if (t - v >= USE_THROTTLE_MS) last.delete(k)
    return true
  }
}
