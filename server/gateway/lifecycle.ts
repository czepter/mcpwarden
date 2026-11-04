import type { Gateway } from './index'
import { SHUTDOWN_DRAIN_MS } from './config'
import { registerLifecycleHandler } from '../utils/user-lifecycle'

/** Sperren/Löschen schließt Pool, Limiter, Katalog (Worker-Stopp hängt in 1.3 an `extra`). */
export function registerGatewayLifecycle(gw: Gateway, extra: { stopWorker?: (userId: string, o: { purge: boolean }) => Promise<void> } = {}) {
  registerLifecycleHandler({
    name: 'gateway',
    onUserDisabled: async (u) => { await gw.onUserDisabled(u); await extra.stopWorker?.(u, { purge: false }) },
    onUserDeleted: async (u) => { await gw.onUserDisabled(u); await extra.stopWorker?.(u, { purge: true }) },
  })
}

/**
 * SIGTERM-Handler (idempotent). Nitro ruft `close` bei SIGTERM nicht verlässlich (Spike 1.2.7 offen,
 * wartet auf das 0a-Artefakt); deshalb ein eigener Handler: drain -> Pool schließen -> Stats flushen -> `closeDb`.
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
