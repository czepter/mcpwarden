import { getAuth, resetAuth } from '../auth'
import { closeDb, getDb } from '../db'
import { getConfig } from '../utils/config'
import { getMasterKey } from '../utils/master-key'
import { markReady } from '../utils/ready'

// Wartet nicht (Nitro wartet async Plugins ohnehin nicht). Requests sind ueber getDb()/getAuth() abgesichert.
function fail(e: unknown): never {
  console.error('[mcpwarden] Start fehlgeschlagen:', e instanceof Error ? e.message : 'unbekannter Fehler')
  process.exit(1)
}

export default defineNitroPlugin((nitroApp) => {
  try {
    getConfig()
    getMasterKey()
  } catch (e) {
    fail(e)
  }
  getDb().then(() => getAuth()).then(markReady).catch(fail)
  nitroApp.hooks.hook('close', async () => {
    resetAuth()
    await closeDb()
    console.log('[mcpwarden] shutdown: db closed')
  })
})
