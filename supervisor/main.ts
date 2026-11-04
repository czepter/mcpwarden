/**
 * Supervisor (Ziel `full`): läuft als root mit nur SETUID/SETGID/CHOWN, startet die Web-App unter der Web-UID,
 * vergibt Nutzer-UIDs selbst und startet pro Nutzer einen Worker. Keine DB, kein MASTER_KEY, kein MCP-Code.
 *
 * Spike 1.3.0 (Linux, node:24-bookworm-slim, cap_drop ALL + SETUID/SETGID/CHOWN) ergab: Der angenommene Socket wird per
 * `spawn(..., { stdio: ['ignore','inherit','inherit', socket] })` als fd 3 an den Worker durchgereicht und bleibt nach
 * `destroy()` der Supervisor-Kopie offen (kein shutdown); 30 MB Transfer ohne Fehler; EOF in beide Richtungen; der Worker
 * unter fremder UID darf den geerbten Deskriptor nutzen; `process.getgroups()` und `id -G` des Workers = nur die vergebene
 * GID (keine Gruppe 0). Es gilt das Design aus Plan 4.1; der Rohpipe-Fallback ist nicht nötig.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeFrame, FrameError, FrameReader, MAX_CONTROL_FRAME, parseCommand, type Command } from './protocol'
import { ensureUserDir, purgeUserDir, realFs, UidMap, UnsafeDirectory, type FsOps } from './users'

export type SupervisorOptions = {
  dataDir: string
  socketPath: string
  webUid: number
  webGid: number
  /** `off`: weder Probe noch Worker noch Datenverbindungen. */
  stdioMode: 'off' | 'auto'
  webCmd: string[]
  workerJs: string
  /** Faktor für die Idle-Minuten (Tests: kleiner als 60000). */
  idleUnitMs?: number
  log?: (msg: string) => void
}

type Worker = { proc: ChildProcess, uid: number, userId: string }
const BACKOFF_MIN = 1000
const BACKOFF_MAX = 30_000
const HARD = { maxProcs: 20, idleMin: 120 }

export async function startSupervisor(o: SupervisorOptions) {
  const log = o.log ?? ((m: string) => process.stderr.write(`[supervisor] ${m}\n`))
  const isRoot = process.getuid?.() === 0
  const workers = new Map<string, Worker>()
  const crashes = new Map<string, { n: number, until: number }>()
  let canSwitchUser = false
  let shuttingDown = false

  // --- Verzeichnisse: erst mkdir/chmod, dann chown (ohne FOWNER/DAC_OVERRIDE geht chmod danach nicht mehr). Kein rekursives chown.
  mkdirSync(dirname(o.socketPath), { recursive: true, mode: 0o755 })
  chmodSync(dirname(o.socketPath), 0o755)
  mkdirSync(o.dataDir, { recursive: true, mode: 0o755 })
  if (o.stdioMode !== 'off') {
    mkdirSync(join(o.dataDir, 'stdio'), { recursive: true, mode: 0o711 })
    chmodSync(join(o.dataDir, 'stdio'), 0o711)
  }
  const pgdata = join(o.dataDir, 'pgdata')
  mkdirSync(pgdata, { recursive: true, mode: 0o700 })
  if (isRoot) {
    const st = statSync(pgdata)
    if (st.uid === 0) chownSync(pgdata, o.webUid, o.webGid) // frisch angelegt: Web-UID
    else if (st.uid !== o.webUid) throw new Error(`DATA_DIR/pgdata gehört uid ${st.uid}, erwartet ${o.webUid}. Einmalig: chown -R ${o.webUid}:${o.webGid} <Volume>/pgdata`)
  }

  // --- Fähigkeitsprobe
  if (o.stdioMode !== 'off' && isRoot) {
    canSwitchUser = await new Promise<boolean>((res) => {
      const p = spawn(process.execPath, ['-e', '0'], { uid: 65534, gid: 65534, stdio: 'ignore' })
      p.on('error', () => res(false))
      p.on('exit', code => res(code === 0))
    })
  }
  log(`stdio=${o.stdioMode} canSwitchUser=${canSwitchUser} root=${isRoot}`)

  const uidmap = new UidMap(join(o.dataDir, 'stdio', '.uidmap'), [o.webUid])
  if (o.stdioMode !== 'off') await uidmap.load()
  const fsOps: FsOps = canSwitchUser ? realFs : { chown: async () => {} }

  // --- Steuer-Socket
  if (existsSync(o.socketPath)) unlinkSync(o.socketPath)
  const server = net.createServer(onConnection)
  await new Promise<void>(r => server.listen(o.socketPath, r))
  chmodSync(o.socketPath, 0o600) // erst chmod, dann chown (danach wäre root nicht mehr Eigentümer)
  if (isRoot) chownSync(o.socketPath, o.webUid, o.webGid)

  function reply(c: net.Socket, obj: unknown) { c.write(encodeFrame(obj, MAX_CONTROL_FRAME)) }

  function onConnection(conn: net.Socket) {
    const reader = new FrameReader(MAX_CONTROL_FRAME)
    const onData = async (chunk: Buffer) => {
      let frames: unknown[]
      try { frames = reader.push(chunk) } catch { conn.destroy(); return }
      for (const f of frames) {
        let cmd: Command
        try { cmd = parseCommand(f) } catch (e) { reply(conn, { ok: false, error: 'bad_command', message: (e as FrameError).message }); conn.end(); return }
        if (cmd.cmd === 'attach') {
          // Der Socket wird übergeben: keine weiteren Bytes dürfen schon gelesen sein.
          if (reader.pending !== 0 || frames.length !== 1) { conn.destroy(); return }
          conn.off('data', onData)
          conn.pause()
          await handleAttach(conn, cmd).catch((e) => { log(`attach failed: ${(e as Error).message}`); try { reply(conn, { ok: false, error: 'internal' }) } catch {} ; conn.destroy() })
          return
        }
        await handleControl(conn, cmd)
      }
    }
    conn.on('data', onData)
    conn.on('error', () => {})
  }

  async function handleControl(conn: net.Socket, cmd: Command) {
    switch (cmd.cmd) {
      case 'ping': return reply(conn, { ok: true })
      case 'capabilities': return reply(conn, { ok: true, canSwitchUser, stdioMode: o.stdioMode, workers: workers.size })
      case 'stopWorker': {
        const uid = await stopWorker(cmd.userId, !!cmd.purge)
        return reply(conn, { ok: true, stopped: uid !== null })
      }
      case 'shutdown': reply(conn, { ok: true }); void shutdown(0); return
      default: return reply(conn, { ok: false, error: 'bad_command' })
    }
  }

  async function handleAttach(conn: net.Socket, cmd: Extract<Command, { cmd: 'attach' }>) {
    if (o.stdioMode === 'off') { reply(conn, { ok: false, error: 'stdio_off' }); conn.end(); return }
    if (shuttingDown) { reply(conn, { ok: false, error: 'shutting_down' }); conn.end(); return }
    if (isRoot && !canSwitchUser) { reply(conn, { ok: false, error: 'no_capabilities' }); conn.end(); return } // nie Worker als root
    if (workers.has(cmd.userId)) { reply(conn, { ok: false, error: 'busy' }); conn.end(); return }
    const bo = crashes.get(cmd.userId)
    if (bo && Date.now() < bo.until) { reply(conn, { ok: false, error: 'backoff', retryMs: bo.until - Date.now() }); conn.end(); return }
    // UID und Verzeichnis ausschließlich aus der userId abgeleitet
    const uid = await uidmap.uidFor(cmd.userId)
    let dir: string
    try { dir = await ensureUserDir(o.dataDir, uid, fsOps, isRoot ? 0 : process.getuid!()) } catch (e) {
      log(`user dir check failed: ${(e as Error).message}`)
      reply(conn, { ok: false, error: e instanceof UnsafeDirectory ? 'unsafe_dir' : 'dir_failed' }); conn.end(); return
    }
    const maxProcs = Math.min(cmd.maxProcs ?? 5, HARD.maxProcs)
    const idleMin = Math.min(cmd.idleMin ?? 10, HARD.idleMin)
    // Saubere Env: nichts vom Supervisor/Web-App (kein MASTER_KEY, BETTER_AUTH_SECRET, DATABASE_URL)
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: join(dir, 'home'), TMPDIR: join(dir, 'tmp'), LANG: 'C.UTF-8',
      NODE_OPTIONS: '--max-old-space-size=256', WORKER_MAX_CHILDREN: String(maxProcs), WORKER_IDLE_MIN: String(idleMin * (o.idleUnitMs ?? 60_000) / 60_000),
    }
    reply(conn, { ok: true }) // Ack vor der Übergabe; danach spricht nur noch der Worker
    // libuv wechselt das Verzeichnis VOR setuid: root ohne CAP_DAC_OVERRIDE kommt nicht in das 0700-Nutzerverzeichnis.
    // Daher cwd = Supervisor-Verzeichnis und `cd` erst in der Shell (dann schon als Nutzer).
    // bash: dash kennt `ulimit -u` nicht (Debian-Image enthält bash)
    const proc = spawn(existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', 'cd "$0" || exit 1; ulimit -u 512 2>/dev/null; exec "$@"', dir, process.execPath, o.workerJs], {
      cwd: join(o.dataDir, 'stdio'), env, detached: true, stdio: ['ignore', 'inherit', 'inherit', conn, 'pipe'],
      ...(canSwitchUser ? { uid, gid: uid } : {}),
    })
    workers.set(cmd.userId, { proc, uid, userId: cmd.userId })
    proc.on('error', (e) => { log(`worker spawn error: ${e.message}`); workers.delete(cmd.userId); conn.destroy() })
    proc.on('spawn', () => setTimeout(() => conn.destroy(), 0)) // Supervisor lässt seine Kopie los
    proc.on('exit', (code, sig) => {
      log(`worker ${cmd.userId} exit code=${code} sig=${sig}`)
      if (workers.get(cmd.userId)?.proc === proc) workers.delete(cmd.userId)
      if (code !== 0 && code !== null && !shuttingDown) {
        const prev = crashes.get(cmd.userId)
        const n = (prev?.n ?? 0) + 1
        crashes.set(cmd.userId, { n, until: Date.now() + Math.min(BACKOFF_MIN * 2 ** (n - 1), BACKOFF_MAX) })
      } else if (code === 0) crashes.delete(cmd.userId)
    })
  }

  async function stopWorker(userId: string, purge: boolean): Promise<number | null> {
    const w = workers.get(userId)
    const uid = w?.uid ?? uidmap.lookup(userId) ?? null
    if (w) {
      // Kein CAP_KILL: Stopp-Signal über den Steuerkanal (fd 4); der Worker beendet Kinder und sich selbst.
      await new Promise<void>((res) => {
        const t = setTimeout(res, 5000)
        w.proc.once('exit', () => { clearTimeout(t); res() })
        const ctl = w.proc.stdio[4] as import('node:stream').Writable | null
        if (ctl) ctl.end('stop\n'); else res()
      })
    }
    crashes.delete(userId)
    if (purge && uid !== null) {
      await purgeUserDir(o.dataDir, uid, argv => new Promise<number>((res) => {
        const p = spawn(argv[0]!, argv.slice(1), { cwd: join(o.dataDir, 'stdio'), stdio: 'ignore', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, ...(canSwitchUser ? { uid, gid: uid } : {}) })
        p.on('error', () => res(127)); p.on('exit', c => res(c ?? 1))
      })) // erst nach dem Stopp aller Prozesse dieser UID
    }
    return w ? uid : null
  }

  // --- Web-App
  const web = spawn(o.webCmd[0]!, o.webCmd.slice(1), { stdio: 'inherit', env: process.env, ...(isRoot ? { uid: o.webUid, gid: o.webGid } : {}) })
  web.on('error', (e) => { log(`cannot start web app: ${e.message}${isRoot ? ' (fehlen SETUID/SETGID im Container? Siehe README)' : ''}`); void shutdown(1) })
  web.on('exit', (code, sig) => { log(`web app exited (${code ?? sig})`); void shutdown(code ?? 1) })

  async function shutdown(code: number) {
    if (shuttingDown) return
    shuttingDown = true
    if (web.exitCode === null) {
      web.kill('SIGTERM')
      await new Promise<void>((res) => { const t = setTimeout(() => { web.kill('SIGKILL'); res() }, 35_000); web.once('exit', () => { clearTimeout(t); res() }) })
    }
    await Promise.all([...workers.keys()].map(u => stopWorker(u, false)))
    server.close()
    try { unlinkSync(o.socketPath) } catch {}
    exitHandler(code)
  }
  let exitHandler: (code: number) => void = c => process.exit(c)
  process.on('SIGTERM', () => { void shutdown(0) })
  process.on('SIGINT', () => { void shutdown(0) })

  return { server, web, workers, shutdown, onExit: (fn: (c: number) => void) => { exitHandler = fn }, canSwitchUser: () => canSwitchUser }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env
  const here = dirname(fileURLToPath(import.meta.url))
  startSupervisor({
    dataDir: env.DATA_DIR ?? '/data',
    socketPath: env.SUP_SOCKET ?? '/run/mcpwarden/sup.sock',
    webUid: Number(env.WEB_UID ?? 10001),
    webGid: Number(env.WEB_GID ?? 10001),
    stdioMode: env.STDIO_MODE === 'off' ? 'off' : 'auto',
    webCmd: env.WEB_CMD ? JSON.parse(env.WEB_CMD) : [process.execPath, '.output/server/index.mjs'],
    workerJs: join(here, 'worker.mjs'),
    idleUnitMs: env.SUP_IDLE_UNIT_MS ? Number(env.SUP_IDLE_UNIT_MS) : undefined,
  }).catch((e) => { process.stderr.write(`[supervisor] fatal: ${(e as Error).message}\n`); process.exit(1) })
}
