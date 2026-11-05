// Mailer-Port. Fachcode kennt nur dieses Interface, nie nodemailer (Adapter: smtp.ts, noop.ts, memory.ts).
export interface Mail {
  to: string
  subject: string
  text: string
  /** Optional; nur aus den Templates in templates.ts (escaped). */
  html?: string
}

export type MailErrorCode = 'invalid' | 'rate_limited' | 'disabled' | 'transport'

/** Meldung enthaelt nie Adressen, Tokens oder Zugangsdaten; nur `code` wird geloggt. */
export class MailError extends Error {
  constructor(public readonly code: MailErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'MailError'
  }
}

export interface Mailer {
  /** false = nichts konfiguriert; Aufrufer blenden Mailfunktionen aus. */
  readonly enabled: boolean
  /** Wirft MailError. Fuer Request-Pfade `trySendMail` benutzen. */
  sendMail: (mail: Mail) => Promise<void>
}
