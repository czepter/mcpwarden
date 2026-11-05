import type { ConnectionOptions } from 'node:tls'
import nodemailer from 'nodemailer'
import type { SmtpConfig } from '../utils/config'
import { MailError, type Mailer } from './types'
import { assertMail } from './validate'

export interface SmtpOptions {
  connectionTimeoutMs?: number
  greetingTimeoutMs?: number
  socketTimeoutMs?: number
  /** Obergrenze je Versuch, unabhaengig von nodemailer. */
  sendTimeoutMs?: number
  /** Zusaetzliche Versuche nach dem ersten (Default 2, also hoechstens 3 Versuche). */
  retries?: number
  backoffMs?: number
  /** Nur Tests (eigene CA). */
  tls?: ConnectionOptions
  log?: (msg: string) => void
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])

/** Fehler, die ein Wiederholen nicht heilt: Auth, Adresse, 5xx, Zertifikat. */
function isPermanent(e: unknown): boolean {
  const err = e as { code?: string, responseCode?: number, message?: string }
  // Mit SMTP-Antwortcode entscheidet dieser (4xx = vorübergehend, 5xx = dauerhaft), unabhängig von der Phase.
  if (typeof err.responseCode === 'number') return err.responseCode >= 500
  if (err.code === 'EAUTH' || err.code === 'EENVELOPE') return true
  return /certificate|self[- ]signed|CERT_|altnames/i.test(err.message ?? '')
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * SMTP ueber nodemailer. smtps:// = implizites TLS; smtp:// = STARTTLS ist Pflicht (Klartext nur an Loopback).
 * Zugangsdaten und Adressen werden nie geloggt, nur ein Fehlercode.
 */
export function createSmtpMailer(smtp: SmtpConfig, from: string, o: SmtpOptions = {}): Mailer {
  const retries = o.retries ?? 2
  const sendTimeoutMs = o.sendTimeoutMs ?? 30_000
  const log = o.log ?? ((m: string) => console.error(m))
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure && !LOOPBACK.has(smtp.host),
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
    connectionTimeout: o.connectionTimeoutMs ?? 10_000,
    greetingTimeout: o.greetingTimeoutMs ?? 10_000,
    socketTimeout: o.socketTimeoutMs ?? 20_000,
    tls: { minVersion: 'TLSv1.2', ...o.tls },
    disableFileAccess: true,
    disableUrlAccess: true,
  })

  async function attempt(mail: Parameters<Mailer['sendMail']>[0]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(Object.assign(new Error('send timeout'), { code: 'ETIMEDOUT' })), sendTimeoutMs)
    })
    try {
      await Promise.race([transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }), timeout])
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    enabled: true,
    sendMail: async (mail) => {
      assertMail(mail, from)
      for (let i = 0; ; i++) {
        try {
          await attempt(mail)
          return
        } catch (e) {
          const code = (e as { code?: string }).code ?? 'unknown'
          if (i >= retries || isPermanent(e)) {
            log(`[mcpwarden] mail: Versand fehlgeschlagen (${code}, Versuch ${i + 1})`)
            throw new MailError('transport')
          }
          await sleep((o.backoffMs ?? 500) * (i + 1))
        }
      }
    },
  }
}
