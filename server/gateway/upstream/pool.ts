import type { Client } from '@modelcontextprotocol/client'
import { POOL_IDLE_MS } from '../config'
import type { Connected } from './connect'
import type { Clock } from './limiter'
import type { UpstreamRow } from './types'

export type PoolEntry = { client: Client, version: number, transport: Connected['transport'], lastUsed: number, inflight: number, retries: number }

export class PoolLimitError extends Error { constructor() { super('Verbindungslimit erreicht') } }

export class Pool {
  private entries = new Map<string, PoolEntry>()
  private connecting = new Map<string, Promise<PoolEntry>>()
  constructor(private o: { connect: (up: UpstreamRow, signal: AbortSignal | undefined, owner: string) => Promise<Connected & { retries?: number }>, maxFor: (userId: string) => number | Promise<number>, now?: Clock }) {}
  private now() { return (this.o.now ?? Date.now)() }
  private key = (userId: string, id: string) => `${userId}:${id}`

  /** Schlüssel enthält die Nutzer-ID: Isolation durch Konstruktion. */
  async get(up: UpstreamRow, signal?: AbortSignal, owner: string = up.userId): Promise<PoolEntry> {
    // `owner` kommt aus dem Auth-Kontext; eine fremde Zeile wird nie verbunden (und nie mit fremdem Schlüssel entschlüsselt)
    if (owner !== up.userId) throw new Error('upstream owner mismatch')
    const k = this.key(up.userId, up.id)
    const hit = this.entries.get(k)
    if (hit && hit.version === up.version) { hit.lastUsed = this.now(); return hit }
    if (hit) await this.drop(k)
    const pending = this.connecting.get(k)
    if (pending) return pending
    const p = (async () => {
      await this.makeRoom(up.userId)
      const c = await this.o.connect(up, signal, owner)
      const entry: PoolEntry = { client: c.client, version: up.version, transport: c.transport, lastUsed: this.now(), inflight: 0, retries: c.retries ?? 0 }
      c.client.onclose = () => { if (this.entries.get(k) === entry) this.entries.delete(k) }
      this.entries.set(k, entry)
      return entry
    })().finally(() => this.connecting.delete(k))
    this.connecting.set(k, p)
    return p
  }

  private async makeRoom(userId: string) {
    const max = await this.o.maxFor(userId)
    const mine = [...this.entries].filter(([k]) => k.startsWith(`${userId}:`))
    if (mine.length < max) return
    const idle = mine.filter(([, e]) => e.inflight === 0).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
    if (!idle) throw new PoolLimitError()
    await this.drop(idle[0])
  }

  private async drop(k: string) {
    const e = this.entries.get(k)
    this.entries.delete(k)
    if (!e) return
    const t = e.client.transport as { terminateSession?: () => Promise<void> } | undefined
    await t?.terminateSession?.().catch(() => {})
    await e.client.close().catch(() => {})
  }

  invalidate(userId: string, upstreamId: string) { return this.drop(this.key(userId, upstreamId)) }
  async closeUser(userId: string) { await Promise.all([...this.entries.keys()].filter(k => k.startsWith(`${userId}:`)).map(k => this.drop(k))) }
  async closeAll() { await Promise.all([...this.entries.keys()].map(k => this.drop(k))) }
  count(userId?: string) { return userId ? [...this.entries.keys()].filter(k => k.startsWith(`${userId}:`)).length : this.entries.size }
  async sweepIdle(idleMs = POOL_IDLE_MS) {
    const cut = this.now() - idleMs
    await Promise.all([...this.entries].filter(([, e]) => e.inflight === 0 && e.lastUsed < cut).map(([k]) => this.drop(k)))
  }
}
