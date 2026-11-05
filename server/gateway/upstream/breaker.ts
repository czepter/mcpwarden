import { BREAKER } from '../config'
import type { Clock } from './limiter'

export type BreakerState = 'closed' | 'open' | 'half-open'

/**
 * Zählt aufeinanderfolgende Fehler (Verbindung, Timeout, 5xx). `isError`, ungültige Argumente,
 * Rate-Limit und denied gehören nicht hierher (Aufrufer entscheidet).
 * 5 in Folge -> open 30 s, Verdopplung bis 5 min; half-open lässt genau einen Probeaufruf durch.
 */
export class Breaker {
  state: BreakerState = 'closed'
  consecutiveFailures = 0
  private openUntil = 0
  private openCycles = 0
  private probing = false
  constructor(private now: Clock = Date.now, private cfg = BREAKER) {}

  get nextRetryAt(): number | null { return this.state === 'open' ? this.openUntil : null }

  /** true = Aufruf darf durch. Ein half-open-Zugang gehört dem Aufrufer, der danach success/failure meldet. */
  allow(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (this.now() < this.openUntil) return false
      this.state = 'half-open'
      this.probing = false
    }
    if (this.probing) return false
    this.probing = true
    return true
  }

  success() {
    this.state = 'closed'
    this.consecutiveFailures = 0
    this.openCycles = 0
    this.probing = false
  }

  failure() {
    this.consecutiveFailures++
    if (this.state === 'half-open' || this.consecutiveFailures >= this.cfg.threshold) {
      const ms = Math.min(this.cfg.openMs * 2 ** this.openCycles, this.cfg.maxOpenMs)
      this.openCycles++
      this.state = 'open'
      this.openUntil = this.now() + ms
      this.probing = false
    }
  }

  /** Probe wurde nicht ausgeführt (z. B. Rate-Limit nach allow()): Zugang freigeben. */
  cancelProbe() { this.probing = false }
}
