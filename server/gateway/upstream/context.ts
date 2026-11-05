import { AsyncLocalStorage } from 'node:async_hooks'

/** Ordnet ausgehende Requests dem Upstream zu (für Retry-After des Upstreams -> Limiter), ohne Host-Raten. */
export const upstreamContext = new AsyncLocalStorage<{ upstreamId: string }>()
