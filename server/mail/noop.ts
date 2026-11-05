import { MailError, type Mailer } from './types'

/** Without SMTP_URL: nothing is sent, `enabled` is false, mail features stay off. */
export function createNoopMailer(): Mailer {
  return {
    enabled: false,
    sendMail: () => Promise.reject(new MailError('disabled', 'Mail sending is not configured')),
  }
}
