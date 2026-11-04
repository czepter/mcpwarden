import { STATS } from '../config'

export type CallStatRow = {
  ts: Date
  userId: string
  clientId: string | null
  tokenId: string | null
  upstreamId: string | null
  upstreamSlug: string
  tool: string | null
  kind: 'list' | 'call'
  status: 'ok' | 'tool_error' | 'timeout' | 'upstream_error' | 'rate_limited' | 'breaker_open' | 'denied'
  totalMs: number
  upstreamMs: number | null
  overheadMs: number | null
  retries: number
  reqBytes: number
  resBytes: number
  cacheHit: boolean
}

export type StatsBufferOptions = {
  /** Schreibt einen Batch; Fehler werden geloggt, nie an Aufrufer gegeben. */
  write: (rows: CallStatRow[]) => Promise<void>
  flushMs?: number
  batch?: number
  max?: number
  log?: (msg: string, err?: unknown) => void
}

/** Ringpuffer im Speicher; `push` blockiert nie und wartet nie auf die DB. */
export class StatsBuffer {
  private rows: CallStatRow[] = []
  private timer: NodeJS.Timeout | null = null
  private flushing: Promise<void> | null = null
  dropped = 0
  constructor(private o: StatsBufferOptions) {}

  start() {
    if (this.timer) return
    this.timer = setInterval(() => { void this.flush() }, this.o.flushMs ?? STATS.flushMs)
    this.timer.unref()
  }

  push(row: CallStatRow) {
    this.rows.push(row)
    const max = this.o.max ?? STATS.maxBuffer
    if (this.rows.length > max) {
      const over = this.rows.length - max
      this.rows.splice(0, over)
      this.dropped += over
    }
    if (this.rows.length >= (this.o.batch ?? STATS.flushBatch)) void this.flush()
  }

  get size() { return this.rows.length }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing
    if (!this.rows.length) return Promise.resolve()
    const batch = this.rows.splice(0, this.o.batch ?? STATS.flushBatch)
    this.flushing = this.o.write(batch)
      .catch((err) => {
        this.o.log?.('stats flush failed', err)
        // Batch zurücklegen (vorne), Überlauf wird beim nächsten push verworfen und gezählt.
        this.rows.unshift(...batch)
      })
      .finally(() => { this.flushing = null })
    return this.flushing
  }

  /** Beim Shutdown: Rest schreiben, Timer stoppen. */
  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (let i = 0; i < 50; i++) {
      await this.flushing
      if (!this.rows.length) break
      const before = this.rows.length
      await this.flush()
      if (this.rows.length >= before) break // DB down: aufgeben
    }
  }
}
