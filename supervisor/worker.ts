/**
 * Worker per user. Knows neither MCP nor the SDK: forwards lines (opaque JSON-RPC strings) between the
 * data connection (fd 3) and stdin/stdout of the child processes. Runs under the UID assigned by the supervisor.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync, writeSync } from 'node:fs'
import net from 'node:net'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { encodeFrame, FrameError, FrameReader, MAX_DATA_FRAME, type FromWorker, type ToWorker } from './protocol'

const MAX_LINE = MAX_DATA_FRAME - 1024
const STDERR_TAIL = 8 * 1024
// kill(-1) only with its own UID (set by the supervisor only after a successful UID switch)
const ISOLATED = process.env.WORKER_ISOLATED === '1'
const ROOT = process.cwd() // = DATA_DIR/stdio/<uid>, set by the supervisor
const MAX_CHILDREN = Number(process.env.WORKER_MAX_CHILDREN ?? 5)
const IDLE_MS = Number(process.env.WORKER_IDLE_MIN ?? 10) * 60_000
// ulimit -u applies per UID (all processes and threads): without its own UID (no ISOLATED) it would also limit the web app/the host user
const CHILD_NPROC = ISOLATED ? Number(process.env.WORKER_CHILD_NPROC ?? 128) : 0
// Further limits per child process (0 = off): virtual memory (MB), CPU seconds, largest file (MB). Best effort.
const CHILD_VMEM_MB = Number(process.env.WORKER_CHILD_VMEM_MB ?? 0)
const CHILD_CPU_S = Number(process.env.WORKER_CHILD_CPU_S ?? 0)
const CHILD_FSIZE_MB = Number(process.env.WORKER_CHILD_FSIZE_MB ?? 1024)
const LIMIT_SCRIPT = '[ "$0" -gt 0 ] && ulimit -u "$0" 2>/dev/null; [ "$1" -gt 0 ] && ulimit -v "$1" 2>/dev/null; [ "$2" -gt 0 ] && ulimit -t "$2" 2>/dev/null; [ "$3" -gt 0 ] && ulimit -f "$3" 2>/dev/null; shift 3; exec "$@"'

const sock = new net.Socket({ fd: 3, readable: true, writable: true })
const reader = new FrameReader(MAX_DATA_FRAME)
const children = new Map<string, { proc: ChildProcess, stderr: string, buf: string }>()
let idleTimer: NodeJS.Timeout | undefined

const send = (m: FromWorker) => {
  if (sock.destroyed) return
  // Backpressure: child process stdout is paused when the connection is full (see below)
  return sock.write(encodeFrame(m))
}

function touch() {
  clearTimeout(idleTimer)
  if (children.size === 0) idleTimer = setTimeout(() => shutdown(0), IDLE_MS)
}

let stopping = false
/**
 * Termination. The supervisor has no CAP_KILL and cannot signal the worker; instead it closes fd 4
 * (see below). Finally `kill(-1, SIGKILL)`: takes care of all remaining processes of this UID (also detached ones).
 */
function shutdown(code: number) {
  if (stopping) return
  stopping = true
  for (const c of children.values()) killChild(c.proc, 'SIGTERM')
  const finish = () => {
    // kill(-1) only with its own UID (WORKER_ISOLATED=1, set by the supervisor only after a successful UID switch).
    // Otherwise it would hit the web app, supervisor and everything else of this UID: then only the process groups of the children.
    if (ISOLATED) {
      // kill(-1) also hits the worker itself: a regular exit is reported beforehand (otherwise it counts as a crash)
      if (code === 0) { try { writeSync(4, 'bye\n') } catch { /* control channel already closed */ } }
      try { process.kill(-1, 'SIGKILL') } catch { /* nichts übrig */ }
    } else {
      for (const c of children.values()) killChild(c.proc, 'SIGKILL')
    }
    process.exit(code)
  }
  if (code !== 0) return finish()
  setTimeout(finish, children.size ? 800 : 0)
}

/** cwd must lie under ROOT (defense in depth; the worker only has user rights anyway). */
function resolveCwd(rel?: string): string {
  if (!rel) { mkdirSync(join(ROOT, 'home'), { recursive: true }); return join(ROOT, 'home') }
  const n = normalize(rel)
  if (isAbsolute(n) || n === '..' || n.startsWith(`..${sep}`)) throw new Error('cwd escapes user directory')
  const rootReal = realpathSync(ROOT)
  // Segment by segment: first check (realpath/lstat), then create. No recursive mkdir across a symlink.
  let cur = rootReal
  for (const seg of n.split(sep).filter(x => x && x !== '.')) {
    const next = join(cur, seg)
    if (lstatSync(next, { throwIfNoEntry: false })) {
      const real = realpathSync(next)
      if (real !== rootReal && !real.startsWith(rootReal + sep)) throw new Error('cwd escapes user directory (symlink)')
      cur = real
    } else {
      mkdirSync(next)
      cur = next
    }
  }
  return cur
}

/** Children run in their own process group (detached); without UID isolation the group is ended specifically, never `kill(-1)`. */
function killChild(proc: ChildProcess, sig: NodeJS.Signals) {
  try {
    if (ISOLATED || !proc.pid) proc.kill(sig)
    else process.kill(-proc.pid, sig)
  } catch { try { proc.kill(sig) } catch { /* already ended */ } }
}

function startChild(m: Extract<ToWorker, { t: 'start' }>) {
  if (children.has(m.childId)) return send({ t: 'error', childId: m.childId, code: 'bad_request', message: 'duplicate child' })
  if (children.size >= MAX_CHILDREN) return send({ t: 'error', childId: m.childId, code: 'limit', message: `max ${MAX_CHILDREN} child processes` })
  let cwd: string
  try {
    mkdirSync(join(ROOT, 'home'), { recursive: true }); mkdirSync(join(ROOT, 'tmp'), { recursive: true })
    cwd = resolveCwd(m.cwdRel)
  } catch (e) { return send({ t: 'error', childId: m.childId, code: 'bad_cwd', message: (e as Error).message }) }
  // Clean env: only what was passed + PATH/HOME/TMPDIR (nothing from the worker/supervisor).
  const env = { ...m.env, PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: join(ROOT, 'home'), TMPDIR: join(ROOT, 'tmp') }
  // ulimit -u: processes per UID (best effort, fork-bomb protection; bash, since dash does not know the option)
  const proc = spawn(existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', LIMIT_SCRIPT, String(CHILD_NPROC), String(CHILD_VMEM_MB * 1024), String(CHILD_CPU_S), String(CHILD_FSIZE_MB * 1024), m.command, ...m.args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  const entry = { proc, stderr: '', buf: '' }
  children.set(m.childId, entry)
  clearTimeout(idleTimer)
  proc.on('error', e => { send({ t: 'error', childId: m.childId, code: 'spawn_failed', message: e.message }) })
  proc.on('spawn', () => send({ t: 'started', childId: m.childId }))
  proc.stdout.on('data', (d: Buffer) => {
    entry.buf += d.toString('utf8')
    if (entry.buf.length > MAX_LINE && !entry.buf.includes('\n')) { entry.buf = ''; killChild(proc, 'SIGKILL'); return }
    let i: number
    while ((i = entry.buf.indexOf('\n')) >= 0) {
      const line = entry.buf.slice(0, i).replace(/\r$/, '')
      entry.buf = entry.buf.slice(i + 1)
      if (line) { if (send({ t: 'msg', childId: m.childId, line }) === false) { proc.stdout.pause(); sock.once('drain', () => proc.stdout.resume()) } }
    }
  })
  proc.stderr.on('data', (d: Buffer) => { entry.stderr = (entry.stderr + d.toString('utf8')).slice(-STDERR_TAIL) })
  proc.stdin.on('error', () => {})
  proc.on('close', (code, signal) => {
    children.delete(m.childId)
    send({ t: 'exit', childId: m.childId, code, signal, stderrTail: entry.stderr })
    touch()
  })
}

sock.on('data', (chunk) => {
  let msgs: unknown[]
  try { msgs = reader.push(chunk) } catch (e) { if (e instanceof FrameError) return shutdown(1); throw e }
  for (const raw of msgs as ToWorker[]) {
    touch()
    if (raw.t === 'start') startChild(raw)
    else if (raw.t === 'msg') {
      const c = children.get(raw.childId)
      if (!c) send({ t: 'error', childId: raw.childId, code: 'unknown_child', message: 'no such child' })
      else c.proc.stdin.write(raw.line + '\n')
    } else if (raw.t === 'stop') { const c = children.get(raw.childId); if (c) killChild(c.proc, 'SIGTERM') }
  }
})
// EOF from the web app (connection closed) => end everything. Conversely the web app sees EOF when the worker exits.
sock.on('end', () => shutdown(0))
sock.on('close', () => shutdown(0))
sock.on('error', () => shutdown(1))
process.on('SIGTERM', () => shutdown(0))
// Control channel to the supervisor (fd 4): data ('stop') or EOF (supervisor gone/stopWorker) ends the worker.
const ctl = new net.Socket({ fd: 4, readable: true, writable: false })
ctl.on('data', () => shutdown(0)); ctl.on('end', () => shutdown(0)); ctl.on('close', () => shutdown(0)); ctl.on('error', () => shutdown(0))
send({ t: 'ready' })
touch()
