import { MailError, type Mailer } from './types'
import { assertMail } from './validate'

export interface RecipientLimit {
  max: number
  windowMs: number
  now?: () => number
}

const MAX_TRACKED = 5000

/** Limits mails per recipient (case-insensitive) in a sliding window. Invalid mails consume no quota. */
export function withRecipientLimit(inner: Mailer, limit: RecipientLimit = { max: 3, windowMs: 3_600_000 }): Mailer {
  const now = limit.now ?? Date.now
  const hits = new Map<string, number[]>()
  return {
    get enabled() { return inner.enabled },
    sendMail: async (mail) => {
      assertMail(mail)
      const t = now()
      const key = `${mail.quota ?? 'notify'}:${mail.to.toLowerCase()}`
      if (hits.size >= MAX_TRACKED) {
        for (const [k, v] of hits) if (!v.some(x => t - x < limit.windowMs)) hits.delete(k)
        if (hits.size >= MAX_TRACKED) throw new MailError('rate_limited', 'Too many recipients in the window')
      }
      const recent = (hits.get(key) ?? []).filter(x => t - x < limit.windowMs)
      if (recent.length >= limit.max) {
        hits.set(key, recent)
        throw new MailError('rate_limited', 'Recipient limit reached')
      }
      recent.push(t)
      hits.set(key, recent)
      return inner.sendMail(mail)
    },
  }
}
