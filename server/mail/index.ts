import { getConfig, type AppConfig } from '../utils/config'
import { createNoopMailer } from './noop'
import { withRecipientLimit } from './ratelimit'
import { createSmtpMailer } from './smtp'
import { MailError, type Mail, type Mailer } from './types'

export type { Mail, Mailer } from './types'
export { MailError } from './types'

export function createMailer(cfg: Pick<AppConfig, 'smtp' | 'mailFrom'>): Mailer {
  if (!cfg.smtp || !cfg.mailFrom) return createNoopMailer()
  return withRecipientLimit(createSmtpMailer(cfg.smtp, cfg.mailFrom))
}

const g = globalThis as typeof globalThis & { __mcpwMailer?: Mailer }

/** Memoisiert aus der Konfiguration. */
export function getMailer(): Mailer {
  return (g.__mcpwMailer ??= createMailer(getConfig()))
}

/**
 * Fuer Request-Pfade: wirft nie. Loggt nur den Fehlercode (nie Adresse, Token oder Zugangsdaten).
 * @returns true, wenn die Mail uebergeben wurde.
 */
export async function trySendMail(mailer: Mailer, mail: Mail, what: string, log: (m: string) => void = m => console.error(m)): Promise<boolean> {
  try {
    await mailer.sendMail(mail)
    return true
  } catch (e) {
    log(`[mcpwarden] mail: ${what} nicht gesendet (${e instanceof MailError ? e.code : 'unknown'})`)
    return false
  }
}
