import { readiness } from '../gateway/health'
import { isDraining, statsDropped, supervisorPing } from '../gateway/runtime'
import { isReady } from '../utils/ready'

export default defineEventHandler(async (event) => {
  // Bereit = migriert, nicht im Herunterfahren und (nur mit aktivem stdio) der Supervisor antwortet. Upstream-Ausfälle zählen nie.
  const h = await readiness({ migrated: isReady(), draining: isDraining(), supervisorPing: supervisorPing() })
  if (h.status !== 200) setResponseStatus(event, h.status)
  return { ready: h.status === 200, stats_dropped: statsDropped(), ...(h.body.status !== 'ok' ? { status: h.body.status } : {}) }
})
