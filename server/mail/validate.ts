import { isMailFrom } from '../utils/config'
import { MailError, type Mail } from './types'

const ADDR = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/

/** CR, LF, NUL and U+2028/U+2029 (line separators in some parsers). */
export function hasLineBreak(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c === 10 || c === 13 || c === 0 || c === 0x2028 || c === 0x2029) return true
  }
  return false
}

/** A single recipient address, no display name, no list. */
export const isRecipient = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && ADDR.test(v)

/** Header injection protection: CR/LF (also NUL, U+2028/9) in to/subject/from are rejected, not sanitized. */
export function assertMail(mail: Mail, from?: string): void {
  if (!isRecipient(mail.to)) throw new MailError('invalid', 'Invalid recipient')
  if (typeof mail.subject !== 'string' || !mail.subject.trim() || mail.subject.length > 200 || hasLineBreak(mail.subject)) {
    throw new MailError('invalid', 'Invalid subject')
  }
  if (typeof mail.text !== 'string' || !mail.text) throw new MailError('invalid', 'Text missing')
  if (mail.html !== undefined && typeof mail.html !== 'string') throw new MailError('invalid', 'Invalid HTML')
  if (from !== undefined && (hasLineBreak(from) || !isMailFrom(from))) throw new MailError('invalid', 'Invalid sender')
}
