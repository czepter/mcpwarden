import { MailError, type Mailer } from './types'

/** Ohne SMTP_URL: nichts wird versendet, `enabled` ist false, Mailfunktionen bleiben aus. */
export function createNoopMailer(): Mailer {
  return {
    enabled: false,
    sendMail: () => Promise.reject(new MailError('disabled', 'Mailversand ist nicht konfiguriert')),
  }
}
