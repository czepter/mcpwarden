/** Ableitungen fuer Client-Listen (Plan 0b, Annahme 13 und Aufgabe 3 Schritt 5). Rein, Zeit injizierbar. */
export const ACTIVE_WINDOW_MS = 5 * 60_000
export const USE_THROTTLE_MS = 60_000
export const CLIENT_EXPIRY_MS = 30 * 24 * 3600_000

/** "Aktiv" = letzter Aufruf hoechstens 5 Minuten her. */
export function isActive(lastUsedAt: Date | null, now: Date): boolean {
  return lastUsedAt !== null && now.getTime() - lastUsedAt.getTime() <= ACTIVE_WINDOW_MS
}

/** `createdAt + 30 Tage`, solange der Client nie genutzt wurde; sonst `null`. */
export function clientExpiresAt(createdAt: Date, lastUsedAt: Date | null): string | null {
  return lastUsedAt === null ? new Date(createdAt.getTime() + CLIENT_EXPIRY_MS).toISOString() : null
}

/** Verfall-Task: nie genutzt und aelter als 30 Tage. */
export function isExpiredUnused(createdAt: Date, lastUsedAt: Date | null, now: Date): boolean {
  return lastUsedAt === null && now.getTime() - createdAt.getTime() > CLIENT_EXPIRY_MS
}

/** Drosselung der `last_used_at`-Schreibzugriffe: hoechstens einmal pro Minute je Schluessel. */
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
