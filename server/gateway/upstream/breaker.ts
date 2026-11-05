import { BREAKER } from '../config'
import type { Clock } from './limiter'

export type BreakerState = 'closed' | 'open' | 'half-open'

/**
 * Counts consecutive failures (connection, timeout, 5xx). `isError`, invalid arguments,
 * rate limit and denied do not belong here (the caller decides).
 * 5 in a row -> open 30 s, doubling up to 5 min; half-open lets exactly one probe call through.
 */
export class Breaker {
  state: BreakerState = 'closed'
  consecutiveFailures = 0
  private openUntil = 0
  private openCycles = 0
  private probing = false
  constructor(private now: Clock = Date.now, private cfg = BREAKER) {}

  get nextRetryAt(): number | null { return this.state === 'open' ? this.openUntil : null }

  /** true = the call may pass. A half-open admission belongs to the caller, who then reports success/failure. */
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

  /** The probe was not executed (e.g. rate limit after allow()): release the admission. */
  cancelProbe() { this.probing = false }
}
