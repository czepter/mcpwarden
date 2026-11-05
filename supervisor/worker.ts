/**
 * Worker pro Nutzer. Kennt weder MCP noch das SDK: leitet Zeilen (opake JSON-RPC-Strings) zwischen
 * Datenverbindung (fd 3) und stdin/stdout der Kindprozesse weiter. Läuft unter der vom Supervisor vergebenen UID.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync, writeSync } from 'node:fs'
import net from 'node:net'
import { isAbsolute, join, normalize, sep } from 'node:path'
import { encodeFrame, FrameError, FrameReader, MAX_DATA_FRAME, type FromWorker, type ToWorker } from './protocol'

const MAX_LINE = MAX_DATA_FRAME - 1024
const STDERR_TAIL = 8 * 1024
// kill(-1) nur mit eigener UID (setzt der Supervisor nur nach erfolgreichem UID-Wechsel)
const ISOLATED = process.env.WORKER_ISOLATED === '1'
const ROOT = process.cwd() // = DATA_DIR/stdio/<uid>, gesetzt vom Supervisor
const MAX_CHILDREN = Number(process.env.WORKER_MAX_CHILDREN ?? 5)
const IDLE_MS = Number(process.env.WORKER_IDLE_MIN ?? 10) * 60_000
// ulimit -u gilt je UID (alle Prozesse und Threads): ohne eigene UID (kein ISOLATED) würde es die Web-App/den Host-Nutzer mitbegrenzen
const CHILD_NPROC = ISOLATED ? Number(process.env.WORKER_CHILD_NPROC ?? 128) : 0
// Weitere Grenzen je Kindprozess (0 = aus): virtueller Speicher (MB), CPU-Sekunden, größte Datei (MB). Best effort.
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
  // Backpressure: Kindprozess-stdout wird pausiert, wenn die Verbindung voll ist (siehe unten)
  return sock.write(encodeFrame(m))
}

function touch() {
  clearTimeout(idleTimer)
  if (children.size === 0) idleTimer = setTimeout(() => shutdown(0), IDLE_MS)
}

let stopping = false
/**
 * Beenden. Der Supervisor hat kein CAP_KILL und kann den Worker nicht signalisieren; er schließt stattdessen fd 4
 * (siehe unten). Zum Schluss `kill(-1, SIGKILL)`: erledigt alle verbliebenen Prozesse dieser UID (auch abgespaltene).
 */
function shutdown(code: number) {
  if (stopping) return
  stopping = true
  for (const c of children.values()) killChild(c.proc, 'SIGTERM')
  const finish = () => {
    // kill(-1) nur mit eigener UID (WORKER_ISOLATED=1, vom Supervisor nur nach erfolgreichem UID-Wechsel gesetzt).
    // Sonst träfe es Web-App, Supervisor und alles andere dieser UID: dann nur die Prozessgruppen der Kinder.
    if (ISOLATED) {
      // kill(-1) trifft auch den Worker selbst: ein regulärer Abschluss wird vorher gemeldet (sonst zählt er als Absturz)
      if (code === 0) { try { writeSync(4, 'bye\n') } catch { /* Steuerkanal schon zu */ } }
      try { process.kill(-1, 'SIGKILL') } catch { /* nichts übrig */ }
    } else {
      for (const c of children.values()) killChild(c.proc, 'SIGKILL')
    }
    process.exit(code)
  }
  if (code !== 0) return finish()
  setTimeout(finish, children.size ? 800 : 0)
}

/** cwd muss unter ROOT liegen (Verteidigung in der Tiefe; der Worker hat ohnehin nur Nutzerrechte). */
function resolveCwd(rel?: string): string {
  if (!rel) { mkdirSync(join(ROOT, 'home'), { recursive: true }); return join(ROOT, 'home') }
  const n = normalize(rel)
  if (isAbsolute(n) || n === '..' || n.startsWith(`..${sep}`)) throw new Error('cwd escapes user directory')
  const rootReal = realpathSync(ROOT)
  // Segment für Segment: erst prüfen (realpath/lstat), dann anlegen. Kein rekursives mkdir über einen Symlink hinaus.
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

/** Kinder laufen in eigener Prozessgruppe (detached); ohne UID-Isolation wird gezielt die Gruppe beendet, nie `kill(-1)`. */
function killChild(proc: ChildProcess, sig: NodeJS.Signals) {
  try {
    if (ISOLATED || !proc.pid) proc.kill(sig)
    else process.kill(-proc.pid, sig)
  } catch { try { proc.kill(sig) } catch { /* schon beendet */ } }
}

function startChild(m: Extract<ToWorker, { t: 'start' }>) {
  if (children.has(m.childId)) return send({ t: 'error', childId: m.childId, code: 'bad_request', message: 'duplicate child' })
  if (children.size >= MAX_CHILDREN) return send({ t: 'error', childId: m.childId, code: 'limit', message: `max ${MAX_CHILDREN} child processes` })
  let cwd: string
  try {
    mkdirSync(join(ROOT, 'home'), { recursive: true }); mkdirSync(join(ROOT, 'tmp'), { recursive: true })
    cwd = resolveCwd(m.cwdRel)
  } catch (e) { return send({ t: 'error', childId: m.childId, code: 'bad_cwd', message: (e as Error).message }) }
  // Saubere Env: nur Übergebenes + PATH/HOME/TMPDIR (nichts vom Worker/Supervisor).
  const env = { ...m.env, PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: join(ROOT, 'home'), TMPDIR: join(ROOT, 'tmp') }
  // ulimit -u: Prozesse pro UID (best effort, Fork-Bomben-Schutz; bash, da dash die Option nicht kennt)
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
// EOF der Web-App (Verbindung zu) => alles beenden. Umgekehrt sieht die Web-App beim Worker-Exit EOF.
sock.on('end', () => shutdown(0))
sock.on('close', () => shutdown(0))
sock.on('error', () => shutdown(1))
process.on('SIGTERM', () => shutdown(0))
// Steuerkanal zum Supervisor (fd 4): Daten ('stop') oder EOF (Supervisor weg/stopWorker) beenden den Worker.
const ctl = new net.Socket({ fd: 4, readable: true, writable: false })
ctl.on('data', () => shutdown(0)); ctl.on('end', () => shutdown(0)); ctl.on('close', () => shutdown(0)); ctl.on('error', () => shutdown(0))
send({ t: 'ready' })
touch()
