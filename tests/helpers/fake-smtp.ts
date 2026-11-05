// In-Process-SMTP-Server fuer Tests (smtp-server, keine externen Dienste). Faengt Mails ab und simuliert Fehler.
import type { Socket } from 'node:net'
import { SMTPServer } from 'smtp-server'

export interface CapturedMail {
  from: string
  to: string[]
  raw: string
  secure: boolean
  user?: string
}

export interface FakeSmtpOptions {
  host?: string
  /** Implizites TLS (smtps). */
  secure?: boolean
  /** STARTTLS anbieten (Default false). */
  starttls?: boolean
  /** Anmeldung erforderlich. */
  auth?: { user: string, pass: string }
  /** Verbindung annehmen, aber nie grüßen. */
  silent?: boolean
  /** DATA nie beantworten. */
  hangOnData?: boolean
  /** Die ersten N DATA-Befehle mit 451 beantworten. */
  tempFailFirst?: number
  /** RCPT immer mit diesem Code ablehnen (z. B. 550). */
  rejectRcpt?: number
}

export interface FakeSmtp {
  host: string
  port: number
  mails: CapturedMail[]
  connections: number
  authAttempts: number
  dataAttempts: number
  close: () => Promise<void>
}

const err = (message: string, responseCode: number) => Object.assign(new Error(message), { responseCode })

export async function startFakeSmtp(o: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const host = o.host ?? '127.0.0.1'
  const sockets = new Set<Socket>()
  const state = { connections: 0, authAttempts: 0, dataAttempts: 0 }
  const mails: CapturedMail[] = []
  const server = new SMTPServer({
    secure: o.secure ?? false,
    logger: false,
    disabledCommands: [...(o.starttls ? [] : ['STARTTLS']), ...(o.auth ? [] : ['AUTH'])],
    authOptional: !o.auth,
    allowInsecureAuth: true,
    onConnect(_session, cb) {
      state.connections++
      if (o.silent) return // nie antworten: der Client muss per Timeout aufgeben
      cb()
    },
    onAuth(auth, _session, cb) {
      state.authAttempts++
      if (o.auth && auth.username === o.auth.user && auth.password === o.auth.pass) return cb(null, { user: auth.username })
      cb(err('Invalid credentials', 535))
    },
    onRcptTo(_addr, _session, cb) {
      cb(o.rejectRcpt ? err('Mailbox unavailable', o.rejectRcpt) : null)
    },
    onData(stream, session, cb) {
      state.dataAttempts++
      if (o.hangOnData) return // Stream nicht lesen, nie antworten
      const chunks: Buffer[] = []
      stream.on('data', c => chunks.push(c as Buffer))
      stream.on('end', () => {
        if (o.tempFailFirst && state.dataAttempts <= o.tempFailFirst) return cb(err('Try again later', 451))
        mails.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map(r => r.address),
          raw: Buffer.concat(chunks).toString('utf8'),
          secure: session.secure,
          user: (session.user as string | undefined),
        })
        cb()
      })
    },
  })
  server.server.on('connection', (s: Socket) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, host, () => resolve((server.server.address() as { port: number }).port))
  })
  return {
    host,
    port,
    mails,
    get connections() { return state.connections },
    get authAttempts() { return state.authAttempts },
    get dataAttempts() { return state.dataAttempts },
    close: () => new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
    }),
  }
}

/** Dekodiert Quoted-Printable (nodemailer kodiert Umlaute und lange Zeilen so). */
export function decodeQuotedPrintable(s: string): string {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
}

/** Liest Header und Klartext-Teil als lesbaren String (ASCII-sicher genug fuer Assertions). */
export function readable(m: CapturedMail): string {
  return decodeQuotedPrintable(m.raw)
}
