import type { Timeouts } from '../config'
import type { HealthStatus, SetupState } from './status'

export type UpstreamRow = {
  id: string
  userId: string
  slug: string
  name: string
  type: 'http' | 'stdio'
  enabled: boolean
  version: number
  url: string | null
  transport: 'auto' | 'streamable' | 'sse'
  authType: 'none' | 'bearer' | 'header' | 'env'
  authHeaderName: string | null
  command: string | null
  args: string[]
  env: Record<string, string>
  cwd: string | null
  ratePerMin: number
  maxConcurrent: number
  timeouts: Partial<Timeouts> | null
  status: HealthStatus
  setup: SetupState
}

export type SecretRow = { upstreamId: string, kind: 'bearer' | 'header' | 'env', name: string, ciphertext: string }

export type UserLimits = {
  maxUpstreams: number
  callsPerMin: number
  maxConnections: number
  stdioAllowed: boolean
  stdioMaxProcs: number
  stdioIdleMin: number
}

/** Persistenz als Interface; die Drizzle-Implementierung hängt an `getDb()` aus 0a. Alle Funktionen nehmen `userId` zuerst. */
export interface GatewayStore {
  listEnabledUpstreams(userId: string): Promise<UpstreamRow[]>
  getUpstreamBySlug(userId: string, slug: string): Promise<UpstreamRow | null>
  getUpstream(userId: string, id: string): Promise<UpstreamRow | null>
  getSecrets(userId: string, upstreamId: string): Promise<SecretRow[]>
  getLimits(userId: string): Promise<UserLimits>
  /** Upsert der gesehenen Tools (`first_seen_at`, `last_seen_at`, `gone`), liefert `enabled` je Name. */
  syncTools(userId: string, upstreamId: string, names: string[]): Promise<Map<string, boolean>>
  toolFlags(userId: string, upstreamId: string): Promise<Map<string, boolean>>
}
