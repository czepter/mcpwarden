import net from 'node:net'
import { getAuth, resetAuth } from '../auth'
import { closeDb, getDb } from '../db'
import { getConfig } from '../utils/config'
import { getMasterKey } from '../utils/master-key'
import { markReady } from '../utils/ready'
import { closeRuntime, getRuntime, markDraining } from '../gateway/runtime'

// Does not wait (Nitro does not wait for async plugins anyway). Requests are guarded via getDb()/getAuth().
function fail(e: unknown): never {
  console.error('[mcpwarden] startup failed:', e instanceof Error ? e.message : 'unknown error')
  process.exit(1)
}

export default defineNitroPlugin((nitroApp) => {
  try {
    getConfig()
    getMasterKey()
  } catch (e) {
    fail(e)
  }
  // Termination by the supervisor (no CAP_KILL): 'stop' or closing the control channel triggers the normal SIGTERM shutdown
  const ctlFd = Number(process.env.WEB_CTL_FD)
  if (Number.isInteger(ctlFd) && ctlFd > 2) {
    const ctl = new net.Socket({ fd: ctlFd, readable: true, writable: false })
    const stop = () => { process.kill(process.pid, 'SIGTERM') }
    ctl.on('data', stop); ctl.on('end', stop); ctl.on('error', stop)
  }
  getDb().then(() => getAuth()).then(() => getRuntime()).then(markReady).catch(fail)
  // SIGTERM: immediately not ready, then let running calls drain (30 s), close pool/workers, flush stats, close DB
  const drain = () => markDraining()
  process.once('SIGTERM', drain)
  process.once('SIGINT', drain)
  nitroApp.hooks.hook('close', async () => {
    markDraining()
    await closeRuntime().catch(e => console.error('[mcpwarden] gateway shutdown:', e instanceof Error ? e.message : 'unknown'))
    resetAuth()
    await closeDb()
    console.log('[mcpwarden] shutdown: db closed')
  })
})
