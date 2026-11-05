/** Registry für Sperren/Löschen (Plan 1.1.3). Handler laufen sequentiell, Fehler stoppen die anderen nicht. */
export type LifecycleHandler = {
  name?: string
  onUserDisabled?: (userId: string) => void | Promise<void>
  onUserDeleted?: (userId: string) => void | Promise<void>
}
const handlers: LifecycleHandler[] = []
let onError: (name: string, err: unknown) => void = () => {}

export const registerLifecycleHandler = (h: LifecycleHandler) => { handlers.push(h) }
export const setLifecycleErrorSink = (fn: typeof onError) => { onError = fn }
export const resetLifecycleHandlers = () => { handlers.length = 0 }

async function run(kind: 'onUserDisabled' | 'onUserDeleted', userId: string) {
  for (const h of handlers) {
    try { await h[kind]?.(userId) } catch (e) { onError(h.name ?? kind, e) }
  }
}
export const runUserDisabled = (userId: string) => run('onUserDisabled', userId)
export const runUserDeleted = (userId: string) => run('onUserDeleted', userId)
