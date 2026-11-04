import { randomBytes } from 'node:crypto'
import { createGateway, type GatewayOptions } from '../../server/gateway'
import { AllowList } from '../../server/gateway/net/ssrf'
import type { CallStatRow } from '../../server/gateway/stats/buffer'
import type { StatusSnapshot } from '../../server/gateway/upstream/status'
import type { AuthContext } from '../../server/gateway/ports'
import { MemoryStore } from './memory-store'

export const ctxFor = (userId: string, extra: Partial<AuthContext> = {}): AuthContext => ({
  userId, tokenType: 'pat', tokenId: `tok-${userId}`, clientId: null, clientName: null, scopes: ['mcp:tools'], expiresAt: null, resource: 'http://localhost/mcp', role: 'user', ...extra,
})

export function makeGateway(over: Partial<GatewayOptions> = {}) {
  const store = new MemoryStore()
  const rows: CallStatRow[] = []
  const statuses: Array<{ id: string, s: StatusSnapshot, prev: string }> = []
  const masterKey = randomBytes(32)
  const gw = createGateway({
    store, masterKey,
    statusSink: { onChange: (id, _u, s, prev) => { statuses.push({ id, s, prev }) } },
    statsWrite: async (r) => { rows.push(...r) },
    getAllow: () => new AllowList(['127.0.0.0/8']), // Tests laufen gegen localhost
    ...over,
  })
  return { store, gw, rows, statuses, masterKey }
}
export const sig = () => new AbortController().signal
