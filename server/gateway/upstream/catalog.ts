import type { Tool } from '@modelcontextprotocol/client'
import { CATALOG_LIMITS, CATALOG_TTL_MS, mergeTimeouts } from '../config'
import type { Clock } from './limiter'
import type { Pool } from './pool'
import type { GatewayStore, UpstreamRow } from './types'

/** Ein Upstream sprengt die Grenzen der Tool-Liste (Seiten, Anzahl, Groesse, Zeit): bricht ab statt unbegrenzt zu sammeln. */
export class CatalogLimitError extends Error {
  constructor(what: string) { super(`Upstream-Tool-Liste zu gross: ${what}`) }
}

export type CatalogResult = { tools: Tool[], fetchedAt: number, stale: boolean }

/** tools/list-Cache je Upstream; Invalidierung durch `version`, Toggle, Upstream-list_changed. */
export class Catalog {
  private cache = new Map<string, { tools: Tool[], fetchedAt: number, version: number }>()
  private inflight = new Map<string, Promise<CatalogResult>>()
  constructor(private o: { pool: Pool, store: GatewayStore, ttlMs?: number, now?: Clock, limits?: Partial<typeof CATALOG_LIMITS> }) {}
  private now() { return (this.o.now ?? Date.now)() }
  private key = (up: { userId: string, id: string }) => `${up.userId}:${up.id}`

  invalidate(userId: string, upstreamId: string) { this.cache.delete(`${userId}:${upstreamId}`) }
  forgetUser(userId: string) { for (const k of [...this.cache.keys()]) if (k.startsWith(`${userId}:`)) this.cache.delete(k) }
  /** true, wenn `list()` aus dem Cache bedient würde (kein Upstream-Zugriff, kein Breaker-Zugang nötig). */
  isFresh(up: UpstreamRow): boolean {
    const c = this.cache.get(this.key(up))
    return !!c && c.version === up.version && this.now() - c.fetchedAt < (this.o.ttlMs ?? CATALOG_TTL_MS)
  }
  cached(up: UpstreamRow): CatalogResult | null {
    const c = this.cache.get(this.key(up))
    return c ? { tools: c.tools, fetchedAt: c.fetchedAt, stale: true } : null
  }

  /** Frisch aus dem Cache oder per Upstream. Bei Fehler wirft die Methode; der Aufrufer nimmt `cached()` als stale. */
  async list(up: UpstreamRow, signal?: AbortSignal, onClientError?: (e: unknown) => void, owner: string = up.userId): Promise<CatalogResult & { cacheHit: boolean }> {
    const k = this.key(up)
    const c = this.cache.get(k)
    if (c && c.version === up.version && this.now() - c.fetchedAt < (this.o.ttlMs ?? CATALOG_TTL_MS)) return { tools: c.tools, fetchedAt: c.fetchedAt, stale: false, cacheHit: true }
    let p = this.inflight.get(k)
    if (!p) {
      p = (async () => {
        try {
          const entry = await this.o.pool.get(up, signal, owner)
          const t = mergeTimeouts(up.timeouts)
          const lim = { ...CATALOG_LIMITS, ...this.o.limits }
          // Ein Zeitbudget fuer die ganze Liste (nicht je Seite), sonst haelt ein endlos blaetternder Upstream die Anfrage beliebig lange
          const budget = AbortSignal.any([AbortSignal.timeout(t.listMs), ...(signal ? [signal] : [])])
          const tools: Tool[] = []
          const seen = new Set<string>()
          let bytes = 0
          let pages = 0
          let cursor: string | undefined
          do {
            if (++pages > lim.maxPages) throw new CatalogLimitError(`mehr als ${lim.maxPages} Seiten`)
            const page = await entry.client.listTools(cursor ? { cursor } : undefined, { signal: budget, timeout: t.listMs })
            tools.push(...page.tools)
            if (tools.length > lim.maxTools) throw new CatalogLimitError(`mehr als ${lim.maxTools} Tools`)
            bytes += JSON.stringify(page.tools).length
            if (bytes > lim.maxBytes) throw new CatalogLimitError(`mehr als ${lim.maxBytes} Bytes`)
            cursor = page.nextCursor
            if (cursor) { if (seen.has(cursor)) throw new CatalogLimitError('Cursor wiederholt sich'); seen.add(cursor) }
          } while (cursor)
          await this.o.store.syncTools(up.userId, up.id, tools.map(x => x.name))
          const fetchedAt = this.now()
          this.cache.set(k, { tools, fetchedAt, version: up.version })
          return { tools, fetchedAt, stale: false }
        } catch (e) { onClientError?.(e); throw e }
      })().finally(() => this.inflight.delete(k))
      this.inflight.set(k, p)
    }
    return { ...(await p), cacheHit: false }
  }
}
