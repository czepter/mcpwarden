import { AsyncLocalStorage } from 'node:async_hooks'

/** Maps outgoing requests to the upstream (for the upstream's Retry-After -> limiter), without host rates. */
export const upstreamContext = new AsyncLocalStorage<{ upstreamId: string }>()
