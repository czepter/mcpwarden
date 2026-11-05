import { randomUUID } from 'node:crypto'
import type { GatewayStore, SecretRow, UpstreamRow, UserLimits } from '../../server/gateway/upstream/types'
import { DEFAULT_LIMITS } from '../../server/gateway/config'

/** In-Memory-Ersatz für das Drizzle-Repository (wartet auf 0a/0b). userId überall zuerst, wie im echten Repo. */
export class MemoryStore implements GatewayStore {
  upstreams: UpstreamRow[] = []
  secrets: Array<SecretRow & { userId: string }> = []
  tools = new Map<string, Map<string, boolean>>() // `${userId}:${upstreamId}` -> name -> enabled
  limits = new Map<string, Partial<UserLimits>>()

  addUpstream(userId: string, p: Partial<UpstreamRow> & Pick<UpstreamRow, 'slug' | 'url'>): UpstreamRow {
    const up: UpstreamRow = {
      id: randomUUID(), userId, name: p.slug, type: 'http', enabled: true, version: 1, transport: 'streamable', authType: 'none', authHeaderName: null,
      command: null, args: [], env: {}, cwd: null, ratePerMin: 60, maxConcurrent: 5, timeouts: null, status: 'unknown', setup: 'ready', ...p,
    }
    this.upstreams.push(up)
    return up
  }
  async listEnabledUpstreams(userId: string) { return this.upstreams.filter(u => u.userId === userId && u.enabled) }
  async getUpstreamBySlug(userId: string, slug: string) { return this.upstreams.find(u => u.userId === userId && u.slug === slug) ?? null }
  async getUpstream(userId: string, id: string) { return this.upstreams.find(u => u.userId === userId && u.id === id) ?? null }
  async getSecrets(userId: string, upstreamId: string) { return this.secrets.filter(s => s.userId === userId && s.upstreamId === upstreamId) }
  async getLimits(userId: string): Promise<UserLimits> {
    return { maxUpstreams: 50, callsPerMin: DEFAULT_LIMITS.callsPerMin, maxConnections: 20, stdioAllowed: false, stdioMaxProcs: 5, stdioIdleMin: 10, ...this.limits.get(userId) }
  }
  async syncTools(userId: string, upstreamId: string, names: string[]) {
    const k = `${userId}:${upstreamId}`
    const m = this.tools.get(k) ?? new Map<string, boolean>()
    for (const n of names) if (!m.has(n)) m.set(n, true)
    this.tools.set(k, m)
    return new Map(m)
  }
  async toolFlags(userId: string, upstreamId: string) { return new Map(this.tools.get(`${userId}:${upstreamId}`) ?? []) }
  setToolEnabled(userId: string, upstreamId: string, name: string, enabled: boolean) { this.tools.get(`${userId}:${upstreamId}`)!.set(name, enabled) }
}
