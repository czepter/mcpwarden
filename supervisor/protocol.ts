/**
 * Wire format for control and data connection: 4-byte length (big endian) + UTF-8 JSON.
 * This module has no dependencies (no SDK, no JSON-RPC) and is used by supervisor, worker and web app.
 */
export const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const MAX_CONTROL_FRAME = 1024 // control commands are tiny; hard-limited (never data-path frames)
export const MAX_DATA_FRAME = 8 * 1024 * 1024 // Worker <-> web app (MCP lines)
export const PROTOCOL_VERSION = 1

export class FrameError extends Error {}

export function encodeFrame(obj: unknown, max = MAX_DATA_FRAME): Buffer {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  if (body.length > max) throw new FrameError('frame too large')
  const head = Buffer.alloc(4)
  head.writeUInt32BE(body.length)
  return Buffer.concat([head, body])
}

/** Incremental decoder; throws FrameError on excess length before memory is allocated. */
export class FrameReader {
  private buf: Buffer = Buffer.alloc(0)
  constructor(private max: number) {}
  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: unknown[] = []
    while (this.buf.length >= 4) {
      const n = this.buf.readUInt32BE(0)
      if (n > this.max) throw new FrameError('frame too large')
      if (this.buf.length < 4 + n) break
      const raw = this.buf.subarray(4, 4 + n)
      this.buf = this.buf.subarray(4 + n)
      try { out.push(JSON.parse(raw.toString('utf8'))) } catch { throw new FrameError('invalid json') }
    }
    return out
  }
  /** Bytes that were already read after the last complete frame. */
  get pending() { return this.buf.length }
}

export type Command =
  | { v: 1, cmd: 'ping' }
  | { v: 1, cmd: 'capabilities' }
  | { v: 1, cmd: 'stopWorker', userId: string, purge?: boolean }
  | { v: 1, cmd: 'shutdown' }
  | { v: 1, cmd: 'attach', userId: string, maxProcs?: number, idleMin?: number }

const ALLOWED_KEYS: Record<Command['cmd'], string[]> = {
  ping: ['v', 'cmd'],
  capabilities: ['v', 'cmd'],
  shutdown: ['v', 'cmd'],
  stopWorker: ['v', 'cmd', 'userId', 'purge'],
  attach: ['v', 'cmd', 'userId', 'maxProcs', 'idleMin'],
}

/**
 * Strict validation: unknown fields (`uid`, `gid`, `cwd`, `path` ...) make the command fail.
 * The web app sends only the userId; UID/paths are determined exclusively by the supervisor.
 */
export function parseCommand(raw: unknown): Command {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new FrameError('invalid command')
  const o = raw as Record<string, unknown>
  if (o.v !== PROTOCOL_VERSION) throw new FrameError('unsupported version')
  const cmd = o.cmd as Command['cmd']
  const allowed = ALLOWED_KEYS[cmd]
  if (typeof cmd !== 'string' || !allowed) throw new FrameError('unknown command')
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new FrameError(`unexpected field ${k}`)
  if (cmd === 'stopWorker' || cmd === 'attach') {
    if (typeof o.userId !== 'string' || !USER_ID_RE.test(o.userId)) throw new FrameError('invalid userId')
  }
  if (cmd === 'stopWorker' && o.purge !== undefined && typeof o.purge !== 'boolean') throw new FrameError('invalid purge')
  if (cmd === 'attach') {
    for (const k of ['maxProcs', 'idleMin'] as const) {
      if (o[k] !== undefined && (!Number.isInteger(o[k]) || (o[k] as number) < 1 || (o[k] as number) > 1000)) throw new FrameError(`invalid ${k}`)
    }
  }
  return o as Command
}

/** Worker <-> web app (data connection). The worker knows no MCP: `line` is an opaque JSON-RPC line. */
export type ToWorker =
  | { t: 'start', childId: string, command: string, args: string[], env: Record<string, string>, cwdRel?: string }
  | { t: 'msg', childId: string, line: string }
  | { t: 'stop', childId: string }
export type FromWorker =
  | { t: 'ready' }
  | { t: 'started', childId: string }
  | { t: 'msg', childId: string, line: string }
  | { t: 'exit', childId: string, code: number | null, signal: string | null, stderrTail: string }
  | { t: 'error', childId: string, code: 'limit' | 'spawn_failed' | 'bad_cwd' | 'unknown_child' | 'bad_request', message: string }
