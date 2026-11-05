import { trySendMail } from './index'
import type { Mailer } from './types'
import { upstreamStatusMail, type NotifyState } from './templates'

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
  /** Mindestabstand je (Upstream, Zustand). */
  windowMs: number
  /** Besitzer und Upstream-Name aus der DB (nie aus dem Ereignis). null = unbekannt, kein Versand. Wird erst im Hintergrund gelesen. */
  lookup: (userId: string, upstreamId: string) => Promise<{ email: string, notify: boolean, name: string } | null>
  now?: () => number
  log?: (m: string) => void
  /** Obergrenze fuer wartende/laufende Benachrichtigungen; darueber wird verworfen (kein Rueckstau). */
  maxPending?: number
}

const ATTENTION = new Set(['open', 'auth_expired'])
const MAX_TRACKED = 5000

/** Welche Zustandsuebergaenge eine Mail ausloesen (gleicher Ausloeser wie der Audit-Eintrag, P0-14). */
export function notifyStateFor(status: string, previous: string): NotifyState | null {
  if (ATTENTION.has(status)) return status as NotifyState
  if (status === 'healthy' && ATTENTION.has(previous)) return 'healthy'
  return null
}

export interface StatusNotifier {
  /** Wirft nie, wartet nicht auf den Versand. Gibt zurueck, ob die Benachrichtigung angenommen wurde. */
  notify: (c: StatusChange) => boolean
  /** Wartet auf laufende Versandaufgaben (Tests, Shutdown). */
  idle: () => Promise<void>
}

/**
 * Statusmails an den Besitzer des Upstreams: nur wenn der Mailer aktiv ist, der Nutzer nicht widersprochen hat und
 * fuer (Upstream, Zustand) im Fenster noch keine Mail rausging. Der Aufrufpfad wird nie blockiert oder zum Scheitern gebracht.
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
      // Reservierung erst nach dem Opt-out-Check: Wer widerspricht, verbraucht kein Fenster.
      if (!reserve(`${c.upstreamId}:${state}`)) return
      await trySendMail(d.mailer, upstreamStatusMail(o.email, d.baseUrl, { id: c.upstreamId, name: o.name, state, reason: c.reason }), 'Statusbenachrichtigung', log)
    } catch {
      log('[mcpwarden] mail: Statusbenachrichtigung nicht gesendet (internal)')
    }
  }

  return {
    notify(c) {
      if (!d.mailer.enabled) return false
      const state = notifyStateFor(c.status, c.previous)
      if (!state) return false
      // Vorab-Drossel ohne DB-Zugriff: im Fenster schon versendet -> gar nicht erst anfassen (Flapping kostet nichts)
      const last = sent.get(`${c.upstreamId}:${state}`)
      if (last !== undefined && now() - last < d.windowMs) return false
      if (inflight.size >= maxPending) {
        log('[mcpwarden] mail: Statusbenachrichtigung verworfen (Warteschlange voll)')
        return false
      }
      const p = run(c, state).finally(() => inflight.delete(p))
      inflight.add(p)
      return true
    },
    idle: async () => { await Promise.all([...inflight]) },
  }
}
