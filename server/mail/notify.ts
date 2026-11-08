import { trySendMail } from './index'
import type { Mailer } from './types'
import { newClientMail, upstreamStatusMail, type NotifyState } from './templates'

export interface StatusChange {
  upstreamId: string
  userId: string
  status: string
  previous: string
  reason: string | null
}

export interface StatusNotifierDeps {
  mailer: Mailer
  baseUrl: string | URL
  /** Minimum spacing per (upstream, state). */
  windowMs: number
  /** Owner and upstream name from the DB (never from the event). null = unknown, no send. Read only in the background. */
  lookup: (userId: string, upstreamId: string) => Promise<{ email: string, notify: boolean, name: string } | null>
  now?: () => number
  log?: (m: string) => void
  /** Upper bound for pending/running notifications; beyond it they are dropped (no backpressure). */
  maxPending?: number
}

const ATTENTION = new Set(['open', 'auth_expired'])
const MAX_TRACKED = 5000

/** Which state transitions trigger a mail (same trigger as the audit entry, P0-14). */
export function notifyStateFor(status: string, previous: string): NotifyState | null {
  if (ATTENTION.has(status)) return status as NotifyState
  if (status === 'healthy' && ATTENTION.has(previous)) return 'healthy'
  return null
}

export interface StatusNotifier {
  /** Never throws, does not wait for the send. Returns whether the notification was accepted. */
  notify: (c: StatusChange) => boolean
  /** Waits for running send tasks (tests, shutdown). */
  idle: () => Promise<void>
}

/**
 * Status mails to the upstream's owner: only if the mailer is active, the user has not opted out and
 * no mail has gone out for (upstream, state) within the window. The call path is never blocked or made to fail.
 */
export function createStatusNotifier(d: StatusNotifierDeps): StatusNotifier {
  const now = d.now ?? Date.now
  const log = d.log ?? (m => console.error(m))
  const maxPending = d.maxPending ?? 50
  const sent = new Map<string, number>()
  const inflight = new Set<Promise<void>>()

  const reserve = (key: string): boolean => {
    const t = now()
    const last = sent.get(key)
    if (last !== undefined && t - last < d.windowMs) return false
    if (sent.size >= MAX_TRACKED) {
      for (const [k, v] of sent) if (t - v >= d.windowMs) sent.delete(k)
      if (sent.size >= MAX_TRACKED) return false
    }
    sent.set(key, t)
    return true
  }

  async function run(c: StatusChange, state: NotifyState) {
    try {
      const o = await d.lookup(c.userId, c.upstreamId)
      if (!o || !o.notify) return
      // Reserve only after the opt-out check: whoever opts out consumes no window.
      if (!reserve(`${c.upstreamId}:${state}`)) return
      await trySendMail(d.mailer, upstreamStatusMail(o.email, d.baseUrl, { id: c.upstreamId, name: o.name, state, reason: c.reason }), 'status notification', log)
    } catch {
      log('[mcpwarden] mail: status notification not sent (internal)')
    }
  }

  return {
    notify(c) {
      if (!d.mailer.enabled) return false
      const state = notifyStateFor(c.status, c.previous)
      if (!state) return false
      // Pre-throttle without DB access: already sent within the window -> do not touch at all (flapping costs nothing)
      const last = sent.get(`${c.upstreamId}:${state}`)
      if (last !== undefined && now() - last < d.windowMs) return false
      if (inflight.size >= maxPending) {
        log('[mcpwarden] mail: status notification dropped (queue full)')
        return false
      }
      const p = run(c, state).finally(() => inflight.delete(p))
      inflight.add(p)
      return true
    },
    idle: async () => { await Promise.all([...inflight]) },
  }
}

export interface NewClientNotifierDeps {
  mailer: Mailer
  baseUrl: string | URL
  /** Owner and client name from the DB (never from the event). null = unknown or banned, no send. Read only in the background. */
  lookup: (userId: string, clientId: string) => Promise<{ email: string, notify: boolean, clientName: string | null } | null>
  log?: (m: string) => void
  maxPending?: number
}

export interface NewClientNotifier {
  /** Never throws, does not wait for the send. */
  notify: (userId: string, clientId: string) => boolean
  idle: () => Promise<void>
}

/** "New client connected" mail to the user themself: once per (user, client) by construction (the caller reports only first uses). */
export function createNewClientNotifier(d: NewClientNotifierDeps): NewClientNotifier {
  const log = d.log ?? (m => console.error(m))
  const maxPending = d.maxPending ?? 50
  const inflight = new Set<Promise<void>>()
  async function run(userId: string, clientId: string) {
    try {
      const o = await d.lookup(userId, clientId)
      if (!o || !o.notify) return
      await trySendMail(d.mailer, newClientMail(o.email, d.baseUrl, o.clientName), 'new client notification', log)
    } catch {
      log('[mcpwarden] mail: new client notification not sent (internal)')
    }
  }
  return {
    notify(userId, clientId) {
      if (!d.mailer.enabled) return false
      if (inflight.size >= maxPending) { log('[mcpwarden] mail: new client notification dropped (queue full)'); return false }
      const p = run(userId, clientId).finally(() => inflight.delete(p))
      inflight.add(p)
      return true
    },
    idle: async () => { await Promise.all([...inflight]) },
  }
}
