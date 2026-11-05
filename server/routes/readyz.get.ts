import { isDraining, statsDropped } from '../gateway/runtime'
import { isReady } from '../utils/ready'

export default defineEventHandler((event) => {
  // Während des Herunterfahrens sofort 503 (Load-Balancer nimmt die Instanz heraus); Upstream-Ausfälle zählen nie
  const ready = isReady() && !isDraining()
  if (!ready) setResponseStatus(event, 503)
  return { ready, stats_dropped: statsDropped(), ...(isDraining() ? { status: 'draining' } : {}) }
})
