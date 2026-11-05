/** Approval policy for stdio (plan 4.2 / 1.3.5): exactly one reason, the first match wins. */
export type StdioReason = 'instance_disabled' | 'not_granted' | 'no_capabilities' | 'supervisor_unreachable' | 'image_slim'
export type StdioPolicyInput = {
  imageTarget: 'slim' | 'full'
  instanceEnabled: boolean
  role: 'admin' | 'user'
  stdioAllowed: boolean
  /** `undefined` = supervisor unreachable. */
  supervisor?: { canSwitchUser: boolean }
}
export function stdioPolicy(i: StdioPolicyInput): { allowed: true } | { allowed: false, reason: StdioReason } {
  if (i.imageTarget === 'slim') return { allowed: false, reason: 'image_slim' }
  if (!i.instanceEnabled) return { allowed: false, reason: 'instance_disabled' }
  if (i.role !== 'admin' && !i.stdioAllowed) return { allowed: false, reason: 'not_granted' }
  if (!i.supervisor) return { allowed: false, reason: 'supervisor_unreachable' }
  if (i.role !== 'admin' && !i.supervisor.canSwitchUser) return { allowed: false, reason: 'no_capabilities' }
  return { allowed: true }
}
