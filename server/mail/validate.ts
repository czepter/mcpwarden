import { isMailFrom } from '../utils/config'
import { MailError, type Mail } from './types'

const CTRL = new RegExp('[\\r\\n\\x00\\u2028\\u2029]')
const ADDR = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/

export const hasLineBreak = (v: string) => CTRL.test(v)

/** Eine einzelne Empfaengeradresse, kein Anzeigename, keine Liste. */
export const isRecipient = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && ADDR.test(v)

/** Header-Injection-Schutz: CR/LF (auch NUL, U+2028/9) in to/subject/from werden abgelehnt, nicht bereinigt. */
export function assertMail(mail: Mail, from?: string): void {
  if (!isRecipient(mail.to)) throw new MailError('invalid', 'Empfaenger ungueltig')
  if (typeof mail.subject !== 'string' || !mail.subject.trim() || mail.subject.length > 200 || hasLineBreak(mail.subject)) {
    throw new MailError('invalid', 'Betreff ungueltig')
  }
  if (typeof mail.text !== 'string' || !mail.text) throw new MailError('invalid', 'Text fehlt')
  if (mail.html !== undefined && typeof mail.html !== 'string') throw new MailError('invalid', 'HTML ungueltig')
  if (from !== undefined && (hasLineBreak(from) || !isMailFrom(from))) throw new MailError('invalid', 'Absender ungueltig')
}
