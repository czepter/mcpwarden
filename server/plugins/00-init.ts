import net from 'node:net'
import { getAuth, resetAuth } from '../auth'
import { closeDb, getDb } from '../db'
import { getConfig } from '../utils/config'
import { getMasterKey } from '../utils/master-key'
import { markReady } from '../utils/ready'
import { closeRuntime, getRuntime, markDraining } from '../gateway/runtime'

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
  // Beendigung durch den Supervisor (kein CAP_KILL): 'stop' oder Schließen des Steuerkanals löst das normale SIGTERM-Herunterfahren aus
  const ctlFd = Number(process.env.WEB_CTL_FD)
  if (Number.isInteger(ctlFd) && ctlFd > 2) {
    const ctl = new net.Socket({ fd: ctlFd, readable: true, writable: false })
    const stop = () => { process.kill(process.pid, 'SIGTERM') }
    ctl.on('data', stop); ctl.on('end', stop); ctl.on('error', stop)
  }
  getDb().then(() => getAuth()).then(() => getRuntime()).then(markReady).catch(fail)
  // SIGTERM: sofort nicht mehr bereit, dann laufende Aufrufe auslaufen lassen (30 s), Pool/Worker schließen, Stats flushen, DB schließen
  const drain = () => markDraining()
  process.once('SIGTERM', drain)
  process.once('SIGINT', drain)
  nitroApp.hooks.hook('close', async () => {
    markDraining()
    await closeRuntime().catch(e => console.error('[mcpwarden] gateway shutdown:', e instanceof Error ? e.message : 'unbekannt'))
    resetAuth()
    await closeDb()
    console.log('[mcpwarden] shutdown: db closed')
  })
})
