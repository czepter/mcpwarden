/**
 * Supervisor (target `full`): runs as root with only SETUID/SETGID/CHOWN, starts the web app under the web UID,
 * assigns user UIDs itself and starts one worker per user. No DB, no MASTER_KEY, no MCP code.
 *
 * Spike 1.3.0 (Linux, node:24-bookworm-slim, cap_drop ALL + SETUID/SETGID/CHOWN) showed: the accepted socket is passed via
 * `spawn(..., { stdio: ['ignore','inherit','inherit', socket] })` as fd 3 to the worker and stays open after
 * `destroy()` of the supervisor's copy (no shutdown); 30 MB transfer without errors; EOF in both directions; the worker
 * under a foreign UID may use the inherited descriptor; `process.getgroups()` and `id -G` of the worker = only the assigned
 * GID (no group 0). The design from plan 4.1 holds; the raw-pipe fallback is not needed.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdirSync, promises as fsp, unlinkSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeFrame, FrameReader, MAX_CONTROL_FRAME, parseCommand, type Command, type FrameError } from './protocol'
import { ensureUserDir, prepareDataDirs, purgeUserDir, realFs, UidMap, UnsafeDirectory, type FsOps } from './users'

export type SupervisorOptions = {
  dataDir: string
  socketPath: string
  webUid: number
  webGid: number
  /** `off`: neither probe nor worker nor data connections. */
  stdioMode: 'off' | 'auto'
  webCmd: string[]
  workerJs: string
  /** Factor for the idle minutes (tests: smaller than 60000). */
  idleUnitMs?: number
  /** Time to wait for a worker to end when stopping, in ms (default 5000; tests: shorter). */
  stopTimeoutMs?: number
  log?: (msg: string) => void
}

type Worker = { proc: ChildProcess, uid: number, userId: string }
const SECRET_ENV = ['MASTER_KEY', 'BETTER_AUTH_SECRET', 'DATABASE_URL']
const BACKOFF_MIN = 1000
const BACKOFF_MAX = 30_000
const HARD = { maxProcs: 20, idleMin: 120 }

/** Is there a process (zombies excluded) with this UID? Reads /proc; without /proc the answer is "no". */
export async function uidHasProcesses(uid: number, procDir = '/proc'): Promise<boolean> {
  let names: string[]
  try { names = (await fsp.readdir(procDir)).filter(n => /^\d+$/.test(n)) } catch { return false }
  for (const n of names) {
    try {
      const st = await fsp.stat(join(procDir, n))
      if (st.uid !== uid) continue
      const status = await fsp.readFile(join(procDir, n, 'status'), 'utf8').catch(() => '')
      if (/^State:\s+Z/m.test(status)) continue // Zombie: nothing left to do
      return true
    } catch { /* process already gone */ }
  }
  return false
}

export async function startSupervisor(o: SupervisorOptions) {
  const log = o.log ?? ((m: string) => process.stderr.write(`[supervisor] ${m}\n`))
  const isRoot = process.getuid?.() === 0
  const workers = new Map<string, Worker>()
  const starting = new Set<string>()
  const crashes = new Map<string, { n: number, until: number }>()
  let canSwitchUser = false
  let shuttingDown = false

  // --- Directories: no symlink, owner checked, chmod/chown via O_NOFOLLOW descriptors (see prepareDataDirs).
  mkdirSync(dirname(o.socketPath), { recursive: true, mode: 0o755 })
  chmodSync(dirname(o.socketPath), 0o755)
  mkdirSync(o.dataDir, { recursive: true, mode: 0o755 })
  await prepareDataDirs({ dataDir: o.dataDir, rootUid: process.getuid?.() ?? 0, webUid: o.webUid, webGid: o.webGid, stdio: o.stdioMode !== 'off', chown: isRoot })

  // --- Capability probe
  if (o.stdioMode !== 'off' && isRoot) {
    canSwitchUser = await new Promise<boolean>((res) => {
      const p = spawn(process.execPath, ['-e', '0'], { uid: 65534, gid: 65534, stdio: 'ignore', env: {} }) // empty env: the secrets are still in ours at this point
      p.on('error', () => res(false))
      p.on('exit', code => res(code === 0))
    })
  }
  log(`stdio=${o.stdioMode} canSwitchUser=${canSwitchUser} root=${isRoot}`)

  const uidmap = new UidMap(join(o.dataDir, 'stdio', '.uidmap'), [o.webUid], process.getuid?.() ?? 0)
  if (o.stdioMode !== 'off') await uidmap.load()
  const fsOps: FsOps = canSwitchUser ? realFs : { chown: async () => {} }

  // --- Control socket
  if (existsSync(o.socketPath)) unlinkSync(o.socketPath)
  const server = net.createServer(onConnection)
  await new Promise<void>(r => server.listen(o.socketPath, r))
  chmodSync(o.socketPath, 0o600) // chmod first, then chown (afterwards root would no longer be the owner)
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
          // The socket is handed over: no further bytes may have been read already.
          if (reader.pending !== 0 || frames.length !== 1) { conn.destroy(); return }
          conn.off('data', handler)
          conn.pause()
          await handleAttach(conn, cmd).catch((e) => { log(`attach failed: ${(e as Error).message}`); try { reply(conn, { ok: false, error: 'internal' }) } catch { /* connection already gone */ } conn.destroy() })
          return
        }
        await handleControl(conn, cmd).catch((e) => {
          log(`control ${cmd.cmd} failed: ${(e as Error).message}`)
          try { reply(conn, { ok: false, error: cmd.cmd === 'stopWorker' ? 'purge_failed' : 'internal' }) } catch { /* connection already gone */ }
        })
      }
    }
    const handler = (chunk: Buffer) => { onData(chunk).catch((e) => { log(`connection handler failed: ${(e as Error).message}`); conn.destroy() }) }
    conn.on('data', handler)
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
    if (isRoot && !canSwitchUser) { reply(conn, { ok: false, error: 'no_capabilities' }); conn.end(); return } // never a worker as root
    if (workers.has(cmd.userId) || starting.has(cmd.userId)) { reply(conn, { ok: false, error: 'busy' }); conn.end(); return }
    starting.add(cmd.userId) // reserve the slot synchronously: there are awaits between the check and workers.set
    try { await startWorker(conn, cmd) } finally { starting.delete(cmd.userId) }
  }

  async function startWorker(conn: net.Socket, cmd: Extract<Command, { cmd: 'attach' }>) {
    const bo = crashes.get(cmd.userId)
    if (bo && Date.now() < bo.until) { reply(conn, { ok: false, error: 'backoff', retryMs: bo.until - Date.now() }); conn.end(); return }
    // UID and directory derived exclusively from the userId
    const uid = await uidmap.uidFor(cmd.userId)
    let dir: string
    try { dir = await ensureUserDir(o.dataDir, uid, fsOps, isRoot ? 0 : process.getuid!()) } catch (e) {
      log(`user dir check failed: ${(e as Error).message}`)
      reply(conn, { ok: false, error: e instanceof UnsafeDirectory ? 'unsafe_dir' : 'dir_failed' }); conn.end(); return
    }
    const maxProcs = Math.min(cmd.maxProcs ?? 5, HARD.maxProcs)
    const idleMin = Math.min(cmd.idleMin ?? 10, HARD.idleMin)
    // Clean env: nothing from the supervisor/web app (no MASTER_KEY, BETTER_AUTH_SECRET, DATABASE_URL)
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: join(dir, 'home'), TMPDIR: join(dir, 'tmp'), LANG: 'C.UTF-8',
      NODE_OPTIONS: '--max-old-space-size=256', WORKER_MAX_CHILDREN: String(maxProcs), WORKER_IDLE_MIN: String(idleMin * (o.idleUnitMs ?? 60_000) / 60_000),
      // kill(-1) is only safe if the worker has its own UID; without a UID switch it would kill the web app
      ...(canSwitchUser ? { WORKER_ISOLATED: '1' } : {}),
      ...Object.fromEntries(['WORKER_CHILD_NPROC', 'WORKER_CHILD_VMEM_MB', 'WORKER_CHILD_CPU_S', 'WORKER_CHILD_FSIZE_MB'].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : [])),
    }
    reply(conn, { ok: true }) // ack before the handover; afterwards only the worker speaks
    // libuv changes the directory BEFORE setuid: root without CAP_DAC_OVERRIDE cannot enter the 0700 user directory.
    // Hence cwd = supervisor directory and `cd` only in the shell (then already as the user).
    // bash: dash does not know `ulimit -u` (the Debian image contains bash)
    // RLIMIT_NPROC counts all processes and threads per UID. Only with its own UID does `ulimit -u` limit the worker; without a UID switch
    // it shares the UID with the web app (and in a host run with everything else of the user): a limit below the
    // threads already running would make every fork() of the worker fail with EAGAIN. There only cgroup/pids_limit sets a limit.
    const nprocLimit = canSwitchUser ? 'ulimit -u 512 2>/dev/null; ' : ''
    const proc = spawn(existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh', ['-c', `cd "$0" || exit 1; ${nprocLimit}exec "$@"`, dir, process.execPath, o.workerJs], {
      cwd: join(o.dataDir, 'stdio'), env, detached: true, stdio: ['ignore', 'inherit', 'inherit', conn, 'pipe'],
      ...(canSwitchUser ? { uid, gid: uid } : {}),
    })
    workers.set(cmd.userId, { proc, uid, userId: cmd.userId })
    let clean = false
    const ctlStream = proc.stdio[4] as import('node:stream').Duplex | null
    ctlStream?.on('data', (d: Buffer) => { if (d.toString().includes('bye')) clean = true })
    ctlStream?.on('error', () => { /* worker ended: ECONNRESET on the control channel is expected */ })
    proc.on('error', (e) => { log(`worker spawn error: ${e.message}`); workers.delete(cmd.userId); conn.destroy() })
    proc.on('spawn', () => setTimeout(() => conn.destroy(), 0)) // the supervisor lets go of its copy
    proc.on('exit', (code, sig) => {
      log(`worker ${cmd.userId} exit code=${code} sig=${sig}`)
      if (workers.get(cmd.userId)?.proc === proc) workers.delete(cmd.userId)
      // Death by signal (code === null, e.g. OOM kill) counts as a crash; a regular exit is reported by the worker via 'bye'
      if (code !== 0 && !clean && !shuttingDown) {
        const prev = crashes.get(cmd.userId)
        const n = (prev?.n ?? 0) + 1
        crashes.set(cmd.userId, { n, until: Date.now() + Math.min(BACKOFF_MIN * 2 ** (n - 1), BACKOFF_MAX) })
      } else if (code === 0 || clean) crashes.delete(cmd.userId)
    })
  }

  /** Waits briefly until no process with this UID is running anymore (only meaningful with a separate UID per user). */
  async function uidGone(uid: number, ms = 3000): Promise<boolean> {
    const end = Date.now() + ms
    for (;;) {
      if (!(await uidHasProcesses(uid))) return true
      if (Date.now() >= end) return false
      await new Promise(r => setTimeout(r, 50))
    }
  }

  async function stopWorker(userId: string, purge: boolean): Promise<number | null> {
    const w = workers.get(userId)
    const uid = w?.uid ?? uidmap.lookup(userId) ?? null
    let exited = true
    if (w) {
      // No CAP_KILL: stop signal via the control channel (fd 4); the worker ends its children and itself.
      exited = await new Promise<boolean>((res) => {
        const t = setTimeout(() => res(false), o.stopTimeoutMs ?? 5000)
        w.proc.once('exit', () => { clearTimeout(t); res(true) })
        const ctl = w.proc.stdio[4] as import('node:stream').Writable | null
        if (ctl) ctl.end('stop\n'); else { clearTimeout(t); res(true) }
      })
    }
    crashes.delete(userId)
    if (purge && uid !== null) {
      // Never delete while processes of the UID are running: the worker must be ended, and with a user switch no process of this UID may remain
      if (!exited) throw new Error('worker did not stop; refusing to purge')
      if (canSwitchUser && !(await uidGone(uid))) throw new Error('processes of the uid are still running; refusing to purge')
      await purgeUserDir(o.dataDir, uid, argv => new Promise<number>((res) => {
        const p = spawn(argv[0]!, argv.slice(1), { cwd: join(o.dataDir, 'stdio'), stdio: 'ignore', env: { PATH: process.env.PATH ?? '/usr/bin:/bin' }, ...(canSwitchUser ? { uid, gid: uid } : {}) })
        p.on('error', () => res(127)); p.on('exit', c => res(c ?? 1))
      })) // only after all processes of this UID have stopped
    }
    return w ? uid : null
  }

  // --- Web-App
  // Pass key material on to the web app only; the supervisor does not keep it in its own process env.
  // Limit: /proc/<pid>/environ of the supervisor still shows the start env (readable by root only). Fully solvable only
  // if the web app reads the values from a file/Docker secret (MASTER_KEY_FILE) — see README.
  const webEnv = { ...process.env }
  for (const k of SECRET_ENV) Reflect.deleteProperty(process.env, k)
  // Control channel fd 3: the supervisor has no CAP_KILL and cannot signal the web app (other UID); it ends
  // itself (signal to its own process) as soon as 'stop' arrives here or the channel closes.
  const web = spawn(o.webCmd[0]!, o.webCmd.slice(1), { stdio: ['inherit', 'inherit', 'inherit', 'pipe'], env: { ...webEnv, WEB_CTL_FD: '3' }, ...(isRoot ? { uid: o.webUid, gid: o.webGid } : {}) })
  ;(web.stdio[3] as import('node:stream').Duplex | null)?.on('error', () => { /* Web-App beendet */ })
  web.on('error', (e) => { log(`cannot start web app: ${e.message}${isRoot ? ' (are SETUID/SETGID missing in the container? See README)' : ''}`); void shutdown(1) })
  web.on('exit', (code, sig) => { log(`web app exited (${code ?? sig})`); void shutdown(code ?? 1) })

  async function shutdown(code: number) {
    if (shuttingDown) return
    shuttingDown = true
    if (web.exitCode === null) {
      try { (web.stdio[3] as import('node:stream').Writable | null)?.end('stop\n') } catch { /* channel already closed */ }
      try { web.kill('SIGTERM') } catch { /* not possible without CAP_KILL: the control channel takes over */ }
      await new Promise<void>((res) => { const t = setTimeout(() => { try { web.kill('SIGKILL') } catch { /* EPERM */ } res() }, 35_000); web.once('exit', () => { clearTimeout(t); res() }) })
    }
    await Promise.all([...workers.keys()].map(u => stopWorker(u, false)))
    server.close()
    try { unlinkSync(o.socketPath) } catch { /* socket file does not exist */ }
    exitHandler(code)
  }
  let exitHandler: (code: number) => void = c => process.exit(c)
  process.on('unhandledRejection', (e) => { log(`unhandled rejection: ${(e as Error)?.message ?? String(e)}`) })
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
