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
  /** Timeout je Schreibvorgang (Standard 5 s). */
  writeTimeoutMs?: number
  /** Versuche je Zeile bei transienten Fehlern, danach verworfen und gezählt (Standard 3). */
  maxAttempts?: number
  /** Gesamtfrist für stop() (Standard 10 s). */
  stopDeadlineMs?: number
  log?: (msg: string, err?: unknown) => void
  now?: () => number
}

type Item = { row: CallStatRow, attempts: number }

const MAX_TEXT = 256
/** NUL-Bytes sind in Postgres-Text unzulässig; freie Textfelder werden gekürzt. */
function sanitize(row: CallStatRow): CallStatRow {
  const out = { ...row } as Record<string, unknown>
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === 'string') out[k] = v.replaceAll('\u0000', '').slice(0, MAX_TEXT)
  }
  return out as CallStatRow
}

/** SQLSTATE-Klasse 22 (Datenfehler) und 23 (Constraint, u. a. 23503 gelöschter Nutzer/Upstream). */
export function isDataError(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 4; i++, e = (e as { cause?: unknown }).cause) {
    const c = (e as { code?: unknown }).code
    if (typeof c === 'string' && /^2[23]/.test(c)) return true
  }
  return false
}

class WriteTimeout extends Error { constructor() { super('stats write timeout') } }

/**
 * Ringpuffer im Speicher; `push` blockiert nie, wirft nie und wartet nie auf die DB.
 * Gelöschte Eltern (Nutzer/Upstream): die DB-Schicht darf FK-Verletzungen (23503) melden; der
 * Puffer isoliert die betroffene Zeile per Batch-Teilung, verwirft nur sie und zählt sie in `dropped`.
 */
export class StatsBuffer {
  private items: Item[] = []
  private timer: NodeJS.Timeout | null = null
  private flushing: Promise<void> | null = null
  private retryAt = 0
  private inflight: Item[] = []
  dropped = 0
  constructor(private o: StatsBufferOptions) {}
  private now() { return (this.o.now ?? Date.now)() }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => { void this.flush().catch(() => {}) }, this.o.flushMs ?? STATS.flushMs)
    this.timer.unref()
  }

  push(row: CallStatRow) {
    try {
      this.items.push({ row: sanitize(row), attempts: 0 })
      this.trim()
      if (this.items.length >= (this.o.batch ?? STATS.flushBatch)) void this.flush().catch(() => {})
    } catch (err) {
      this.dropped++
      this.o.log?.('stats push failed', err)
    }
  }

  private trim() {
    const max = this.o.max ?? STATS.maxBuffer
    if (this.items.length > max) {
      const over = this.items.length - max
      this.items.splice(0, over)
      this.dropped += over
    }
  }

  get size() { return this.items.length }

  private async writeWithTimeout(rows: CallStatRow[]) {
    let timer: NodeJS.Timeout | undefined
    try {
      // Hängt der Writer, räumen wir `flushing` trotzdem; ein spätes Gelingen kann Zeilen doppelt schreiben (akzeptiert, Statistik).
      await Promise.race([
        Promise.resolve().then(() => this.o.write(rows)),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new WriteTimeout()), this.o.writeTimeoutMs ?? 5_000) }),
      ])
    } finally { clearTimeout(timer) }
  }

  /** Schreibt; bei Datenfehler Batch teilen, bis die fehlerhafte Zeile isoliert und verworfen ist. */
  private async writeIsolating(items: Item[]): Promise<Item[]> {
    try { await this.writeWithTimeout(items.map(i => i.row)); return [] } catch (err) {
      if (!isDataError(err)) throw Object.assign(err instanceof Error ? err : new Error(String(err)), { unwritten: items })
      if (items.length === 1) { this.dropped++; this.o.log?.('stats row dropped (data error)', err); return [] }
      const mid = items.length >> 1
      const left = await this.writeIsolating(items.slice(0, mid)).catch(e => (e as { unwritten: Item[] }).unwritten ?? items.slice(0, mid))
      const right = await this.writeIsolating(items.slice(mid)).catch(e => (e as { unwritten: Item[] }).unwritten ?? items.slice(mid))
      return [...left, ...right]
    }
  }

  flush(force = false): Promise<void> {
    if (this.flushing) return this.flushing
    if (!this.items.length || (!force && this.now() < this.retryAt)) return Promise.resolve()
    const batch = this.items.splice(0, this.o.batch ?? STATS.flushBatch)
    this.inflight = batch
    this.flushing = (async () => {
      let failed: Item[]
      try { failed = await this.writeIsolating(batch) } catch (err) {
        this.o.log?.('stats flush failed', err)
        failed = (err as { unwritten?: Item[] }).unwritten ?? batch
      }
      if (failed.length) {
        const max = this.o.maxAttempts ?? 3
        const keep: Item[] = []
        for (const it of failed) { it.attempts++; if (it.attempts >= max) this.dropped++; else keep.push(it) }
        this.items.unshift(...keep)
        this.trim()
        const worst = Math.max(...failed.map(i => i.attempts))
        this.retryAt = this.now() + Math.min(1000 * 2 ** worst, 30_000)
      } else this.retryAt = 0
    })().catch(() => {}).finally(() => { this.flushing = null; this.inflight = [] })
    return this.flushing
  }

  /** Beim Shutdown: Rest schreiben (Gesamtfrist), Rest verwerfen und zählen. */
  async stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const deadline = this.now() + (this.o.stopDeadlineMs ?? 10_000)
    while ((this.items.length || this.flushing) && this.now() < deadline) {
      const before = this.items.length + this.dropped
      await Promise.race([this.flush(true), new Promise(r => setTimeout(r, Math.max(0, deadline - this.now())))])
      if (this.items.length + this.dropped >= before && this.flushing === null && this.items.length) {
        // kein Fortschritt (DB down): kurz warten statt Busy-Loop
        await new Promise(r => setTimeout(r, 20))
      }
    }
    const left = this.items.length + this.inflight.length
    if (left) {
      this.dropped += left
      this.inflight = []
      this.o.log?.(`stats: ${left} rows dropped at shutdown deadline`)
      this.items = []
    }
  }
}
