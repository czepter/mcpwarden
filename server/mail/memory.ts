import type { Mail, MailError, Mailer } from './types'
import { assertMail } from './validate'

export interface MemoryMailer extends Mailer {
  readonly outbox: Mail[]
  /** The next sends fail (error-path tests). */
  failWith: MailError | undefined
}

/** Test adapter: collects mails in memory; applies the same rules as the SMTP adapter. */
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
