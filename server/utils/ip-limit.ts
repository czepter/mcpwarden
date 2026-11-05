/** Einfaches Fenster-Limit je (Schlüssel, IP) im Speicher; für öffentliche Routen ohne Better-Auth-Limiter. */
const hits = new Map<string, { n: number, resetAt: number }>()

export function allowRequest(ip: string, bucket: string, max: number, windowMs: number, now = Date.now()): boolean {
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  const key = `${bucket}:${ip}`
  const e = hits.get(key)
  if (!e || e.resetAt <= now) { hits.set(key, { n: 1, resetAt: now + windowMs }); return true }
  e.n++
  return e.n <= max
}
