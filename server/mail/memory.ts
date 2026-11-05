import type { Mail, MailError, Mailer } from './types'
import { assertMail } from './validate'

export interface MemoryMailer extends Mailer {
  readonly outbox: Mail[]
  /** Naechste Sendungen schlagen fehl (Fehlerpfad-Tests). */
  failWith: MailError | undefined
}

/** Testadapter: sammelt Mails im Speicher; prueft dieselben Regeln wie der SMTP-Adapter. */
export function createMemoryMailer(from = 'mcpwarden <noreply@example.com>'): MemoryMailer {
  const outbox: Mail[] = []
  const m: MemoryMailer = {
    enabled: true,
    outbox,
    failWith: undefined,
    sendMail: async (mail) => {
      assertMail(mail, from)
      if (m.failWith) throw m.failWith
      outbox.push({ ...mail })
    },
  }
  return m
}
