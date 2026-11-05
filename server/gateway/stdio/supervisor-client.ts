import net from 'node:net'
import { encodeFrame, FrameReader, MAX_CONTROL_FRAME, MAX_DATA_FRAME, type Command, type FromWorker, type ToWorker } from '../../../supervisor/protocol'

export class SupervisorError extends Error {
  constructor(public code: string, public retryMs?: number) { super(`supervisor: ${code}`) }
}

type Reply = { ok: boolean, error?: string, retryMs?: number, [k: string]: unknown }

/** Steuerverbindung (kurzlebig je Befehl) und Datenverbindungen je Nutzer-Worker. Sendet nur userId, nie UID/Pfade. */
export class SupervisorClient {
  constructor(private socketPath: string) {}

  private connect(): Promise<net.Socket> {
    return new Promise((res, rej) => {
      const s = net.connect(this.socketPath)
      s.once('connect', () => res(s))
      s.once('error', e => rej(new SupervisorError((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? 'supervisor_unreachable' : 'connect_failed')))
    })
  }

  private async request(cmd: Command, timeoutMs = 10_000): Promise<Reply> {
    const s = await this.connect()
    try {
      const reader = new FrameReader(MAX_CONTROL_FRAME)
      const reply = new Promise<Reply>((res, rej) => {
        s.on('data', (d) => { try { const f = reader.push(d); if (f.length) res(f[0] as Reply) } catch (e) { rej(e) } })
        s.on('close', () => rej(new SupervisorError('closed')))
        s.on('error', rej)
      })
      s.write(encodeFrame(cmd, MAX_CONTROL_FRAME))
      return await Promise.race([reply, new Promise<never>((_, rej) => setTimeout(() => rej(new SupervisorError('timeout')), timeoutMs).unref())])
    } finally { s.destroy() }
  }

  async ping() { try { return (await this.request({ v: 1, cmd: 'ping' }, 2000)).ok === true } catch { return false } }
  async capabilities() { return await this.request({ v: 1, cmd: 'capabilities' }) as Reply & { canSwitchUser: boolean, stdioMode: string, workers: number } }
  async stopWorker(userId: string, purge = false) { await this.request({ v: 1, cmd: 'stopWorker', userId, purge }, 30_000) }

  /** attach: danach spricht nur noch der Worker über diese Verbindung (fd 3 im Worker). */
  async attach(userId: string, limits: { maxProcs?: number, idleMin?: number } = {}): Promise<WorkerSession> {
    const s = await this.connect()
    const reader = new FrameReader(MAX_DATA_FRAME)
    const queue: unknown[] = []
    let ackResolve: ((v: Reply) => void) | undefined
    let ack: Reply | undefined
    let ready: () => void = () => {}
    const readyP = new Promise<void>((res) => { ready = res })
    let session: WorkerSession | undefined
    s.on('data', (d) => {
      let frames: unknown[]
      try { frames = reader.push(d) } catch { s.destroy(); return }
      for (const f of frames) {
        if (!ack) { ack = f as Reply; ackResolve?.(ack); continue }
        if (!session) { queue.push(f); continue }
        session.dispatch(f as FromWorker)
      }
    })
    const closed = new Promise<void>(res => s.once('close', () => res()))
    s.on('error', () => {})
    s.write(encodeFrame({ v: 1, cmd: 'attach', userId, ...limits } satisfies Command, MAX_CONTROL_FRAME))
    const a = await Promise.race([
      new Promise<Reply>((res) => { if (ack) res(ack); else ackResolve = res }),
      closed.then(() => { throw new SupervisorError('closed') }),
    ])
    if (!a.ok) { s.destroy(); throw new SupervisorError(a.error ?? 'attach_failed', a.retryMs) }
    session = new WorkerSession(s)
    void closed.then(() => session!.markClosed())
    for (const f of queue) { const m = f as FromWorker; if (m.t === 'ready') ready(); else session.dispatch(m) }
    session.onReady = ready
    await Promise.race([readyP, closed.then(() => { throw new SupervisorError('worker_exited') })])
    return session
  }
}

type ChildHandler = (m: FromWorker) => void

/** Eine Datenverbindung zu einem Worker; multiplext Kindprozesse per childId. */
export class WorkerSession {
  closed = false
  onReady: () => void = () => {}
  private handlers = new Map<string, ChildHandler>()
  private closeListeners: Array<() => void> = []
  constructor(private socket: net.Socket) {}
  dispatch(m: FromWorker) {
    if (m.t === 'ready') return this.onReady()
    this.handlers.get(m.childId)?.(m)
  }
  markClosed() { this.closed = true; this.handlers.forEach(h => h({ t: 'exit', childId: '', code: null, signal: 'CONNECTION_CLOSED', stderrTail: '' })); this.handlers.clear(); this.closeListeners.forEach(f => f()) }
  onClose(f: () => void) { if (this.closed) f(); else this.closeListeners.push(f) }
  send(m: ToWorker) { if (this.closed) throw new SupervisorError('worker_closed'); this.socket.write(encodeFrame(m)) }
  register(childId: string, h: ChildHandler) { this.handlers.set(childId, h) }
  unregister(childId: string) { this.handlers.delete(childId) }
  close() { this.socket.destroy() }
}
