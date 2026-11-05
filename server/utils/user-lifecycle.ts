/** Registry für Sperren/Löschen (Plan 1.1.3). Handler laufen sequentiell, Fehler stoppen die anderen nicht. */
export type LifecycleHandler = {
  name?: string
  /** Sperre/Loeschen: Zugangsdaten des Nutzers (PATs, OAuth-Grants) endgueltig widerrufen, damit Entsperren sie nicht wiederbelebt. */
  onUserBanned?: (userId: string) => void | Promise<void>
  /** Laufzeit-Ressourcen stoppen (Pool, Worker, Limiter); auch beim Entzug der stdio-Freigabe, dann ohne Widerruf der Zugangsdaten. */
  onUserDisabled?: (userId: string) => void | Promise<void>
  onUserDeleted?: (userId: string) => void | Promise<void>
}
const handlers: LifecycleHandler[] = []
let onError: (name: string, err: unknown) => void = () => {}

export const registerLifecycleHandler = (h: LifecycleHandler) => { handlers.push(h) }
export const setLifecycleErrorSink = (fn: typeof onError) => { onError = fn }
export const resetLifecycleHandlers = () => { handlers.length = 0 }

async function run(kind: 'onUserBanned' | 'onUserDisabled' | 'onUserDeleted', userId: string) {
  for (const h of handlers) {
    try { await h[kind]?.(userId) } catch (e) { onError(h.name ?? kind, e) }
  }
}
/** Sperre (oder Loeschen): erst Zugangsdaten widerrufen, dann die Laufzeit-Ressourcen stoppen. */
export const runUserBanned = async (userId: string) => { await run('onUserBanned', userId); await run('onUserDisabled', userId) }
export const runUserDisabled = (userId: string) => run('onUserDisabled', userId)
export const runUserDeleted = (userId: string) => run('onUserDeleted', userId)
