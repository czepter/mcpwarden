/** Rate-Limit: Token-Bucket je Nutzer/Token/Upstream plus Semaphore je Upstream (P0-5). Zeitquelle injizierbar. */
export type Clock = () => number

export class TokenBucket {
  private tokens: number
  private last: number
  constructor(private capacity: number, private perMin: number, private now: Clock) {
    this.tokens = capacity
    this.last = now()
  }
  configure(capacity: number, perMin: number) { this.capacity = capacity; this.perMin = perMin; this.tokens = Math.min(this.tokens, capacity) }
  private refill() {
    const t = this.now()
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) * this.perMin) / 60_000)
    this.last = t
  }
  /** Sekunden bis ein Token frei ist; 0 = jetzt frei. */
  waitSec(): number {
    this.refill()
    if (this.tokens >= 1) return 0
    return Math.max(1, Math.ceil(((1 - this.tokens) * 60) / this.perMin))
  }
  take() { this.refill(); this.tokens -= 1 }
}

export type LimitScope = 'user' | 'token' | 'upstream' | 'concurrency'
export type AcquireInput = {
  userId: string
  tokenId?: string | null
  upstreamId: string
  userPerMin: number
  ratePerMin: number
  maxConcurrent: number
}
export type AcquireResult = { ok: true, release: () => void } | { ok: false, scope: LimitScope, retryAfterSec: number }

export class Limiter {
  private buckets = new Map<string, TokenBucket>()
  private inflight = new Map<string, number>()
  private tokenOwner = new Map<string, string>() // Token-Bucket -> Nutzer, damit forgetUser sie entfernen kann
  private blockedUntil = new Map<string, number>()
  private hits = new Map<string, number[]>()
  constructor(private now: Clock = Date.now) {}

  private bucket(key: string, perMin: number) {
    let b = this.buckets.get(key)
    if (!b) this.buckets.set(key, (b = new TokenBucket(perMin, perMin, this.now)))
    else b.configure(perMin, perMin)
    return b
  }

  /** Upstream sendete Retry-After: bis dahin keine Aufrufe. */
  blockUpstream(upstreamId: string, seconds: number) { this.blockedUntil.set(upstreamId, this.now() + seconds * 1000) }
  upstreamBlockedUntil(upstreamId: string) { const t = this.blockedUntil.get(upstreamId); return t && t > this.now() ? t : null }

  private deny(upstreamId: string, scope: LimitScope, retryAfterSec: number): AcquireResult {
    if (scope === 'upstream' || scope === 'concurrency') {
      const arr = this.hits.get(upstreamId) ?? []
      arr.push(this.now())
      this.hits.set(upstreamId, arr)
    }
    return { ok: false, scope, retryAfterSec }
  }

  /** Reihenfolge Nutzer -> Token -> Upstream; erst prüfen, dann alle Tokens abziehen. */
  acquire(i: AcquireInput): AcquireResult {
    const blocked = this.upstreamBlockedUntil(i.upstreamId)
    if (blocked) return this.deny(i.upstreamId, 'upstream', Math.max(1, Math.ceil((blocked - this.now()) / 1000)))
    const ub = this.bucket(`u:${i.userId}`, i.userPerMin)
    if (i.tokenId) this.tokenOwner.set(i.tokenId, i.userId)
    const tb = i.tokenId ? this.bucket(`t:${i.tokenId}`, i.userPerMin) : null
    const pb = this.bucket(`p:${i.userId}:${i.upstreamId}`, i.ratePerMin)
    const wu = ub.waitSec()
    if (wu) return this.deny(i.upstreamId, 'user', wu)
    const wt = tb?.waitSec() ?? 0
    if (wt) return this.deny(i.upstreamId, 'token', wt)
    const wp = pb.waitSec()
    if (wp) return this.deny(i.upstreamId, 'upstream', wp)
    const key = `${i.userId}:${i.upstreamId}`
    const n = this.inflight.get(key) ?? 0
    if (n >= i.maxConcurrent) return this.deny(i.upstreamId, 'concurrency', 1)
    ub.take(); tb?.take(); pb.take()
    this.inflight.set(key, n + 1)
    let released = false
    return {
      ok: true,
      release: () => {
        if (released) return
        released = true
        const c = (this.inflight.get(key) ?? 1) - 1
        if (c <= 0) this.inflight.delete(key)
        else this.inflight.set(key, c)
      },
    }
  }

  inflightCount(userId: string, upstreamId: string) { return this.inflight.get(`${userId}:${upstreamId}`) ?? 0 }

  /** Treffer der letzten 5 min (für `rateLimitHits5m`). */
  hitsLast5m(upstreamId: string): number {
    const cut = this.now() - 300_000
    const arr = (this.hits.get(upstreamId) ?? []).filter(t => t >= cut)
    this.hits.set(upstreamId, arr)
    return arr.length
  }

  /** Aufräumen beim Löschen/Sperren. */
  forgetUser(userId: string) {
    // Nutzer-IDs enthalten kein ':'; exakte Übereinstimmung bzw. Präfix mit Trenner, damit 'ab' nicht 'abc' trifft
    for (const k of [...this.buckets.keys()]) if (k === `u:${userId}` || k.startsWith(`p:${userId}:`)) this.buckets.delete(k)
    for (const [tok, owner] of [...this.tokenOwner]) if (owner === userId) { this.buckets.delete(`t:${tok}`); this.tokenOwner.delete(tok) }
    for (const k of [...this.inflight.keys()]) if (k.startsWith(`${userId}:`)) this.inflight.delete(k)
  }
}
