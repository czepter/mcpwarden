import { deleteExpiredClients } from '../auth/dcr-store'
import { getDb } from '../db'

// Verfall nie genutzter DCR-Registrierungen (Plan 0b, Aufgabe 3). Single-Instance genuegt:
// ponytail: setInterval statt Nitro scheduledTasks (experimentell); bei mehreren Instanzen ist das Loeschen idempotent.
const DAY_MS = 24 * 3600_000

export default defineNitroPlugin((nitroApp) => {
  const run = () => {
    getDb()
      .then(db => deleteExpiredClients(db, new Date()))
      .then(n => n > 0 && console.log(`[mcpwarden] ${n} unused oauth client(s) expired`))
      .catch(() => console.error('[mcpwarden] client expiry run failed'))
  }
  const timer = setInterval(run, DAY_MS)
  timer.unref()
  setTimeout(run, 60_000).unref()
  nitroApp.hooks.hook('close', () => clearInterval(timer))
})
