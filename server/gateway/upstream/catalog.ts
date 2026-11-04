import type { Tool } from '@modelcontextprotocol/client'
import { CATALOG_TTL_MS, mergeTimeouts } from '../config'
import type { Clock } from './limiter'
import type { Pool } from './pool'
import type { GatewayStore, UpstreamRow } from './types'

export type CatalogResult = { tools: Tool[], fetchedAt: number, stale: boolean }

/** tools/list-Cache je Upstream; Invalidierung durch `version`, Toggle, Upstream-list_changed. */
export class Catalog {
  private cache = new Map<string, { tools: Tool[], fetchedAt: number, version: number }>()
  private inflight = new Map<string, Promise<CatalogResult>>()
  constructor(private o: { pool: Pool, store: GatewayStore, ttlMs?: number, now?: Clock }) {}
  private now() { return (this.o.now ?? Date.now)() }
  private key = (up: { userId: string, id: string }) => `${up.userId}:${up.id}`

  invalidate(userId: string, upstreamId: string) { this.cache.delete(`${userId}:${upstreamId}`) }
  forgetUser(userId: string) { for (const k of [...this.cache.keys()]) if (k.startsWith(`${userId}:`)) this.cache.delete(k) }
  cached(up: UpstreamRow): CatalogResult | null {
    const c = this.cache.get(this.key(up))
    return c ? { tools: c.tools, fetchedAt: c.fetchedAt, stale: true } : null
  }

  /** Frisch aus dem Cache oder per Upstream. Bei Fehler wirft die Methode; der Aufrufer nimmt `cached()` als stale. */
  async list(up: UpstreamRow, signal?: AbortSignal, onClientError?: (e: unknown) => void): Promise<CatalogResult & { cacheHit: boolean }> {
    const k = this.key(up)
    const c = this.cache.get(k)
    if (c && c.version === up.version && this.now() - c.fetchedAt < (this.o.ttlMs ?? CATALOG_TTL_MS)) return { tools: c.tools, fetchedAt: c.fetchedAt, stale: false, cacheHit: true }
    let p = this.inflight.get(k)
    if (!p) {
      p = (async () => {
        try {
          const entry = await this.o.pool.get(up, signal)
          const t = mergeTimeouts(up.timeouts)
          const tools: Tool[] = []
          let cursor: string | undefined
          do {
            const page = await entry.client.listTools(cursor ? { cursor } : undefined, { signal: AbortSignal.any([AbortSignal.timeout(t.listMs), ...(signal ? [signal] : [])]), timeout: t.listMs })
            tools.push(...page.tools)
            cursor = page.nextCursor
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
