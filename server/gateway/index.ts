import { POOL_IDLE_MS } from './config'
import { decryptSecret } from './crypto/secrets'
import { createSafeFetch, type FetchLike } from './net/safe-fetch'
import type { AllowList } from './net/ssrf'
import { GatewayCore } from './proxy/handlers'
import { StatsBuffer, type CallStatRow } from './stats/buffer'
import { Catalog } from './upstream/catalog'
import { connectUpstream, type ConnectDeps, type Credentials } from './upstream/connect'
import { Limiter } from './upstream/limiter'
import { UpstreamOAuthProvider, type OAuthVault } from './upstream/oauth'
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
  /** OAuth upstreams: encrypted session store and the callback URL registered at the upstream's authorization server. */
  oauth?: { vault: OAuthVault, redirectUrl: string }
  notifyChanged?: (userId: string) => void
  log?: (msg: string, err?: unknown) => void
  now?: () => number
  /** Idle limit of the pool connections (default POOL_IDLE_MS) and interval of the cleanup loop (default 60 s); for tests. */
  poolIdleMs?: number
  sweepMs?: number
}

/**
 * Assembles the gateway parts with injected dependencies. The result `toolSource`
 * implements `ToolSource` (0b); DB binding and auth come via `GatewayStore`/`ports.ts`.
 */
export function createGateway(o: GatewayOptions) {
  const limiter = new Limiter(o.now)
  const safeFetch = o.safeFetch ?? createSafeFetch({
    getAllow: o.getAllow,
    // Retry-After of the upstream (429/503) blocks exactly this upstream in the limiter (P0-5); mapping via the call context
    onRetryAfter: (_host, seconds) => { const c = upstreamContext.getStore(); if (c) limiter.blockUpstream(c.upstreamId, Math.min(seconds, 3600)) },
  })
  const credentials = async (up: UpstreamRow, owner: string = up.userId): Promise<Credentials> => {
    // Key and query always from the owner in the auth context, never from the loaded row
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
  const oauth = o.oauth
  const deps: ConnectDeps = {
    safeFetch, credentials, stdioTransport: o.stdioTransport,
    oauthProvider: oauth ? (up, owner) => new UpstreamOAuthProvider({ vault: oauth.vault, userId: owner, upstreamId: up.id, redirectUrl: oauth.redirectUrl, interactive: false }) : undefined,
  }
  const pool = new Pool({ connect: (up, signal, owner) => connectUpstream(up, deps, signal, owner), maxFor: async u => (await o.store.getLimits(u)).maxConnections })
  // Without a cleanup loop connections (and thus stdio child processes) would stay open forever: the worker's idle timer
  // (processes = 0) would never kick in.
  const sweeper = setInterval(() => { limiter.prune(); void pool.sweepIdle(o.poolIdleMs ?? POOL_IDLE_MS).catch(e => o.log?.('pool sweep', e)) }, o.sweepMs ?? 60_000)
  sweeper.unref()
  const catalog = new Catalog({ pool, store: o.store, now: o.now })
  const stats = new StatsBuffer({ write: o.statsWrite, log: o.log })
  stats.start() // timed flush (flushMs), otherwise rows would stay in memory until shutdown
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
    core, pool, catalog, limiter, stats, healthFor, safeFetch, credentials, oauth,
    /** Lifecycle: ban/delete. */
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
