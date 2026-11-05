/** Registry for banning/deleting (plan 1.1.3). Handlers run sequentially; errors do not stop the others. */
export type LifecycleHandler = {
  name?: string
  /** Ban/delete: permanently revoke the user's credentials (PATs, OAuth grants) so that unbanning does not revive them. */
  onUserBanned?: (userId: string) => void | Promise<void>
  /** Stop runtime resources (pool, worker, limiter); also when stdio access is revoked, then without revoking the credentials. */
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
/** Ban (or delete): first revoke credentials, then stop the runtime resources. */
export const runUserBanned = async (userId: string) => { await run('onUserBanned', userId); await run('onUserDisabled', userId) }
export const runUserDisabled = (userId: string) => run('onUserDisabled', userId)
export const runUserDeleted = (userId: string) => run('onUserDeleted', userId)
