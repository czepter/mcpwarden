import { randomUUID } from 'node:crypto'
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client'
import type { FromWorker } from '../../../supervisor/protocol'
import type { WorkerSession } from './supervisor-client'

export class StdioChildError extends Error {
  constructor(public code: string, message: string, public stderrTail = '') { super(message) }
}

/** `Transport` over frames of the worker data connection: one child process = one transport. */
export class IpcTransport implements Transport {
  onclose?: () => void
  onerror?: (e: Error) => void
  onmessage?: Transport['onmessage']
  private childId = randomUUID()
  private closedFlag = false
  private started = false
  stderrTail = ''
  constructor(private session: WorkerSession, private spec: { command: string, args: string[], env: Record<string, string>, cwdRel?: string }) {}

  async start() {
    await new Promise<void>((res, rej) => {
      this.session.register(this.childId, (m: FromWorker) => {
        if (m.t === 'started') { this.started = true; return res() }
        // Before the start, start() fails; afterwards the error belongs to onerror (otherwise it would be swallowed)
        if (m.t === 'error') { const e = new StdioChildError(m.code, m.message); if (this.started) this.onerror?.(e); else rej(e); return }
        if (m.t === 'msg') {
          try { this.onmessage?.(JSON.parse(m.line) as JSONRPCMessage) } catch (e) { this.onerror?.(e as Error) }
          return
        }
        if (m.t === 'exit') {
          this.stderrTail = m.stderrTail
          rej(new StdioChildError('exited', `stdio process exited (${m.code ?? m.signal})`, m.stderrTail))
          this.finish()
        }
      })
      this.session.send({ t: 'start', childId: this.childId, ...this.spec })
    })
  }

  async send(message: JSONRPCMessage) {
    if (this.closedFlag) throw new StdioChildError('closed', 'transport closed')
    this.session.send({ t: 'msg', childId: this.childId, line: JSON.stringify(message) })
  }

  private finish() {
    if (this.closedFlag) return
    this.closedFlag = true
    this.session.unregister(this.childId)
    this.onclose?.()
  }

  async close() {
    if (this.closedFlag) return
    try { this.session.send({ t: 'stop', childId: this.childId }) } catch { /* connection already gone */ }
    this.finish()
  }
}
