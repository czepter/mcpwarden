import { deleteExpiredClients } from '../auth/dcr-store'
import { getDb } from '../db'

// Expiry of never-used DCR registrations (plan 0b, task 3). A single instance suffices:
// ponytail: setInterval instead of Nitro scheduledTasks (experimental); with several instances the deletion is idempotent.
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
