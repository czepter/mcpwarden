import { POOL_IDLE_MS } from './config'
import { decryptSecret } from './crypto/secrets'
import { createSafeFetch, type FetchLike } from './net/safe-fetch'
import type { AllowList } from './net/ssrf'
import { GatewayCore } from './proxy/handlers'
import { StatsBuffer, type CallStatRow } from './stats/buffer'
import { Catalog } from './upstream/catalog'
import { connectUpstream, type ConnectDeps, type Credentials } from './upstream/connect'
import { Limiter } from './upstream/limiter'
import { upstreamContext } from './upstream/context'
import { Pool } from './upstream/pool'
import { UpstreamHealth, type StatusSink } from './upstream/status'
import type { GatewayStore, UpstreamRow } from './upstream/types'
import type { Transport } from '@modelcontextprotocol/client'

export type GatewayOptions = {
  store: GatewayStore
  masterKey: Buffer
  statusSink: StatusSink
  statsWrite: (rows: CallStatRow[]) => Promise<void>
  getAllow?: () => AllowList | Promise<AllowList>
  safeFetch?: FetchLike
  stdioTransport?: (up: UpstreamRow, creds: Credentials) => Promise<Transport>
  notifyChanged?: (userId: string) => void
  log?: (msg: string, err?: unknown) => void
  now?: () => number
  /** Leerlaufgrenze der Pool-Verbindungen (Default POOL_IDLE_MS) und Takt der Aufräumschleife (Default 60 s); für Tests. */
  poolIdleMs?: number
  sweepMs?: number
}

/**
 * Setzt die Gateway-Teile mit injizierten Abhängigkeiten zusammen. Das Ergebnis `toolSource`
 * implementiert `ToolSource` (0b); DB-Anbindung und Auth kommen über `GatewayStore`/`ports.ts`.
 */
export function createGateway(o: GatewayOptions) {
  const limiter = new Limiter(o.now)
  const safeFetch = o.safeFetch ?? createSafeFetch({
    getAllow: o.getAllow,
    // Retry-After des Upstreams (429/503) sperrt genau diesen Upstream im Limiter (P0-5); Zuordnung über den Aufrufkontext
    onRetryAfter: (_host, seconds) => { const c = upstreamContext.getStore(); if (c) limiter.blockUpstream(c.upstreamId, Math.min(seconds, 3600)) },
  })
  const credentials = async (up: UpstreamRow, owner: string = up.userId): Promise<Credentials> => {
    // Schlüssel und Abfrage immer vom Eigentümer aus dem Auth-Kontext, nie aus der geladenen Zeile
    if (owner !== up.userId) throw new Error('upstream owner mismatch')
    const out: Credentials = { headers: {}, env: {} }
    for (const s of await o.store.getSecrets(owner, up.id)) {
      if (s.upstreamId !== up.id) throw new Error('secret row does not belong to this upstream')
      const v = decryptSecret(o.masterKey, owner, { upstreamId: s.upstreamId, kind: s.kind, name: s.name }, s.ciphertext)
      if (s.kind === 'bearer') out.bearer = v
      else if (s.kind === 'header') out.headers![s.name] = v
      else if (s.kind === 'env') out.env![s.name] = v
    }
    return out
  }
  const deps: ConnectDeps = { safeFetch, credentials, stdioTransport: o.stdioTransport }
  const pool = new Pool({ connect: (up, signal, owner) => connectUpstream(up, deps, signal, owner), maxFor: async u => (await o.store.getLimits(u)).maxConnections })
  // Ohne Aufraeumschleife blieben Verbindungen (und damit stdio-Kindprozesse) ewig offen: der Leerlauf-Timer des Workers
  // (Prozesse = 0) kaeme nie zum Zug.
  const sweeper = setInterval(() => { limiter.prune(); void pool.sweepIdle(o.poolIdleMs ?? POOL_IDLE_MS).catch(e => o.log?.('pool sweep', e)) }, o.sweepMs ?? 60_000)
  sweeper.unref()
  const catalog = new Catalog({ pool, store: o.store, now: o.now })
  const stats = new StatsBuffer({ write: o.statsWrite, log: o.log })
  stats.start() // zeitgesteuertes Flush (flushMs), sonst blieben Zeilen bis zum Shutdown im Speicher
  const health = new Map<string, UpstreamHealth>()
  const healthFor = (up: UpstreamRow) => {
    let h = health.get(up.id)
    if (!h) health.set(up.id, (h = new UpstreamHealth(up.userId, up.id, { enabled: up.enabled, setup: up.setup, status: up.status }, o.statusSink, o.now)))
    else h.configure({ enabled: up.enabled, setup: up.setup })
    return h
  }
  const core = new GatewayCore({ store: o.store, pool, catalog, limiter, stats, healthFor, notifyChanged: o.notifyChanged })
  return {
    toolSource: core as import('./ports').ToolSource,
    core, pool, catalog, limiter, stats, healthFor, safeFetch, credentials,
    /** Lebenszyklus: Sperre/Löschen. */
    async onUserDisabled(userId: string) {
      await pool.closeUser(userId)
      limiter.forgetUser(userId)
      catalog.forgetUser(userId)
      for (const [id, h] of health) if (h.userId === userId) health.delete(id)
    },
    async shutdown(drainMs = 30_000) {
      clearInterval(sweeper)
      await core.drain(drainMs)
      await pool.closeAll()
      await stats.stop()
      await (safeFetch as { close?: () => Promise<void> }).close?.()
    },
  }
}
export type Gateway = ReturnType<typeof createGateway>
