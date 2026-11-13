// Mailer port. Domain code knows only this interface, never nodemailer (adapters: smtp.ts, noop.ts, memory.ts).
export interface Mail {
  to: string
  subject: string
  text: string
  /** Optional; only from the templates in templates.ts (escaped). */
  html?: string
  /**
   * Quota class for the per-recipient limit. Mails an anonymous third party can trigger (password reset) use their own class,
   * so that triggering them cannot use up the quota of the notifications a user depends on. Default: `notify`.
   */
  quota?: 'notify' | 'reset'
}

export type MailErrorCode = 'invalid' | 'rate_limited' | 'disabled' | 'transport'

/** The message never contains addresses, tokens or credentials; only `code` is logged. */
export class MailError extends Error {
  constructor(public readonly code: MailErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'MailError'
  }
}

export interface Mailer {
  /** false = nothing configured; callers hide mail features. */
  readonly enabled: boolean
  /** Throws MailError. For request paths use `trySendMail`. */
  sendMail: (mail: Mail) => Promise<void>
}
