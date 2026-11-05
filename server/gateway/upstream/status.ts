import { Breaker } from './breaker'
import type { Clock } from './limiter'

export type HealthStatus = 'unknown' | 'healthy' | 'degraded' | 'open' | 'auth_expired' | 'disabled'
export type SetupState = 'ready' | 'awaiting_auth' | 'awaiting_approval'
export type StatusSnapshot = { status: HealthStatus, reason: string | null, nextRetryAt: number | null }

export type FailureKind = 'connect' | 'timeout' | 'http5xx' | 'auth'

/** Persistenz-/Audit-Schnittstelle (Implementierung hängt an der DB aus 0a). */
export interface StatusSink {
  onChange(upstreamId: string, userId: string, next: StatusSnapshot, prev: HealthStatus): void | Promise<void>
}

/** Reine Berechnung (Plan Abschnitt 6). */
export function computeStatus(i: {
  enabled: boolean, setup: SetupState, authExpired: boolean, everOk: boolean,
  breaker: Breaker, consecutiveFailures: number, lastFailure?: string,
}): StatusSnapshot {
  if (!i.enabled) return { status: 'disabled', reason: 'Upstream ist deaktiviert', nextRetryAt: null }
  if (i.setup !== 'ready') return { status: 'unknown', reason: 'Einrichtung unvollständig', nextRetryAt: null }
  if (i.authExpired) return { status: 'auth_expired', reason: 'Upstream lehnt die Anmeldung ab (401/403)', nextRetryAt: null }
  if (i.breaker.state !== 'closed') {
    return { status: 'open', reason: `${i.breaker.consecutiveFailures} Fehler in Folge, Breaker offen`, nextRetryAt: i.breaker.nextRetryAt }
  }
  if (i.consecutiveFailures > 0) {
    return { status: 'degraded', reason: `${i.consecutiveFailures} Fehler in Folge${i.lastFailure ? `, zuletzt ${i.lastFailure}` : ''}`, nextRetryAt: null }
  }
  return i.everOk ? { status: 'healthy', reason: null, nextRetryAt: null } : { status: 'unknown', reason: null, nextRetryAt: null }
}

const LABEL: Record<FailureKind, string> = { connect: 'Verbindungsfehler', timeout: 'Timeout', http5xx: 'Serverfehler', auth: 'Anmeldung abgelehnt' }

/** Gesundheit eines Upstreams: Breaker + Zähler; Persistenz nur bei Statuswechsel. */
export class UpstreamHealth {
  readonly breaker: Breaker
  private fails = 0
  private everOk = false
  private authExpired = false
  private last: FailureKind | undefined
  status: HealthStatus
  constructor(
    readonly userId: string, readonly upstreamId: string,
    private cfg: { enabled: boolean, setup: SetupState, status?: HealthStatus },
    private sink: StatusSink, now: Clock = Date.now,
  ) {
    this.breaker = new Breaker(now)
    this.status = cfg.status ?? 'unknown'
  }

  configure(c: { enabled: boolean, setup: SetupState }) { this.cfg = { ...this.cfg, ...c }; this.publish() }
  snapshot(): StatusSnapshot {
    return computeStatus({ ...this.cfg, authExpired: this.authExpired, everOk: this.everOk, breaker: this.breaker, consecutiveFailures: this.fails, lastFailure: this.last && LABEL[this.last] })
  }
  private publish() {
    const s = this.snapshot()
    if (s.status === this.status) return
    const prev = this.status
    this.status = s.status
    void Promise.resolve(this.sink.onChange(this.upstreamId, this.userId, s, prev)).catch(() => {})
  }
  success() { this.fails = 0; this.everOk = true; this.authExpired = false; this.last = undefined; this.breaker.success(); this.publish() }
  failure(kind: FailureKind) {
    if (kind === 'auth') { this.authExpired = true; this.breaker.cancelProbe() } // Auth zählt nicht als Ausfall, gibt aber den Half-open-Zugang frei
    else { this.fails++; this.last = kind; this.breaker.failure() }
    this.publish()
  }
}
