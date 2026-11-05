/** Konstanten des Gateways (Plan Abschnitt 4/6). Keine ENV, siehe E7. */
export const TIMEOUTS = { connectMs: 10_000, listMs: 15_000, callMs: 60_000, stdioConnectMs: 60_000 } as const
export const RETRY = { attempts: 3, baseMs: 500, capMs: 10_000 } as const
export const BREAKER = { threshold: 5, openMs: 30_000, maxOpenMs: 300_000 } as const
export const DEFAULT_LIMITS = {
  ratePerMin: 60,
  maxConcurrent: 5,
  maxUpstreams: 50,
  callsPerMin: 120,
  maxConnections: 20,
  stdioMaxProcs: 5,
  stdioIdleMin: 10,
} as const
/** Ein Client gilt als aktiv, wenn sein letzter Aufruf jünger ist (E18). */
export const ACTIVE_WINDOW_MS = 5 * 60_000
export const INVITE_TTL_DAYS = 7
export const CATALOG_TTL_MS = 10 * 60_000
/** Obergrenzen fuer `tools/list` eines Upstreams (Seiten, Tools, Gesamtgroesse); die Gesamtzeit ist `timeouts.listMs`. */
export const CATALOG_LIMITS = { maxPages: 50, maxTools: 2_000, maxBytes: 4 * 1024 * 1024 } as const
export const POOL_IDLE_MS = 5 * 60_000
export const STATS = { flushMs: 5_000, flushBatch: 500, maxBuffer: 10_000, retentionDays: 14 } as const
export const SHUTDOWN_DRAIN_MS = 30_000

export type Timeouts = { connectMs: number, listMs: number, callMs: number }
export const mergeTimeouts = (o?: Partial<Timeouts> | null): Timeouts => ({
  connectMs: o?.connectMs ?? TIMEOUTS.connectMs,
  listMs: o?.listMs ?? TIMEOUTS.listMs,
  callMs: o?.callMs ?? TIMEOUTS.callMs,
})
