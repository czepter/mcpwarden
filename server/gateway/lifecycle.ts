import type { Gateway } from './index'
import { SHUTDOWN_DRAIN_MS } from './config'
import { registerLifecycleHandler } from '../utils/user-lifecycle'

/** Banning/deleting closes pool, limiter, catalog (worker stop hangs off `extra` in 1.3). */
export function registerGatewayLifecycle(gw: Gateway, extra: { stopWorker?: (userId: string, o: { purge: boolean }) => Promise<void> } = {}) {
  registerLifecycleHandler({
    name: 'gateway',
    onUserDisabled: async (u) => { await gw.onUserDisabled(u); await extra.stopWorker?.(u, { purge: false }) },
    onUserDeleted: async (u) => { await gw.onUserDisabled(u); await extra.stopWorker?.(u, { purge: true }) },
  })
}

/**
 * SIGTERM handler (idempotent). Nitro does not reliably call `close` on SIGTERM (spike 1.2.7 open,
 * waiting for the 0a artifact); hence a handler of our own: drain -> close pool -> flush stats -> `closeDb`.
 */
export function installShutdown(gw: Gateway, closeDb: () => Promise<void>, onDraining: () => void, exit: (code: number) => void = process.exit) {
  let started = false
  const run = async () => {
    if (started) return
    started = true
    onDraining()
    try { await gw.shutdown(SHUTDOWN_DRAIN_MS); await closeDb() } finally { exit(0) }
  }
  process.once('SIGTERM', () => { void run() })
  process.once('SIGINT', () => { void run() })
  return run
}
