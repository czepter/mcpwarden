/**
 * Audit entries: callers pass only `action`; `scope`, `category` and `result` come from the action table
 * so that they cannot drift apart (plan 4.2, E17). No name, no email, no secret in `meta`.
 */
export type AuditEntry = {
  userId?: string | null
  actor: string // user:<id> | admin:<id> | system
  clientId?: string | null
  action: AuditAction
  targetType: 'upstream' | 'secret' | 'tool' | 'user' | 'invite' | 'setting' | 'limits'
  targetId?: string | null
  targetLabel?: string | null
  meta?: Record<string, unknown>
}

type Meta = { scope: 'user' | 'instance', category: 'management' | 'auth' | 'status' | 'denied', result: 'success' | 'denied' | 'pending' | 'status_change' }
const U: Meta = { scope: 'user', category: 'management', result: 'success' }
const I: Meta = { scope: 'instance', category: 'management', result: 'success' }
const S: Meta = { scope: 'user', category: 'status', result: 'status_change' }

export const AUDIT_ACTIONS = {
  'upstream.create': U, 'upstream.update': U, 'upstream.delete': U, 'upstream.enable': U, 'upstream.disable': U,
  'secret.replace': U, 'secret.delete': U, 'tool.enable': U, 'tool.disable': U,
  'upstream.status': S,
  'user.ban': I, 'user.unban': I, 'user.delete': I, 'user.limits': I,
  'invite.create': I, 'invite.use': I, 'invite.revoke': I,
  'setting.change': I,
} as const satisfies Record<string, Meta>
export type AuditAction = keyof typeof AUDIT_ACTIONS

const FORBIDDEN_KEY = /mail|secret|token|password|key|value|authorization/i

/** Keys with sensitive names and long texts are dropped; only flat, short values remain. */
export function auditMeta(meta?: Record<string, unknown>): Record<string, unknown> | null {
  if (!meta) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_KEY.test(k)) continue
    if (typeof v === 'string') out[k] = v.slice(0, 200)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

export const auditShape = (a: AuditAction): Meta => AUDIT_ACTIONS[a]

export type AuditWriter = { audit: (e: AuditEntry & Meta) => Promise<void> }

/** Writes best effort: an audit failure must never make the action fail. */
export async function audit(repo: AuditWriter, e: AuditEntry, log: (m: string, err?: unknown) => void = () => {}) {
  try { await repo.audit({ ...e, ...auditShape(e.action) }) } catch (err) { log('audit write failed', err) }
}
