import { describe, expect, it, vi } from 'vitest'
import { createMailer, trySendMail } from '../../server/mail'
import { createMemoryMailer } from '../../server/mail/memory'
import { createNoopMailer } from '../../server/mail/noop'
import { withRecipientLimit } from '../../server/mail/ratelimit'
import { buildLink, escapeHtml, resetPasswordMail } from '../../server/mail/templates'
import { MailError } from '../../server/mail/types'
import { assertMail } from '../../server/mail/validate'
import { buildAuthOptions } from '../../server/auth/options'

const good = { to: 'a@example.com', subject: 'Hallo', text: 'Text' }

describe('Header injection protection', () => {
  it('accepts a clean mail', () => {
    expect(() => assertMail(good, 'mcpwarden <noreply@example.com>')).not.toThrow()
  })
  it.each([
    ['to with LF', { ...good, to: 'a@example.com\nBcc: x@y.de' }],
    ['to with CRLF', { ...good, to: 'a@example.com\r\nBcc: x@y.de' }],
    ['to with comma list', { ...good, to: 'a@example.com,b@example.com' }],
    ['to with display name', { ...good, to: 'Eve <a@example.com>' }],
    ['to empty', { ...good, to: '' }],
    ['subject with LF', { ...good, subject: 'Hi\nBcc: x@y.de' }],
    ['subject with CR', { ...good, subject: 'Hi\rBcc: x@y.de' }],
    ['subject with U+2028', { ...good, subject: 'Hi\u2028Bcc: x@y.de' }],
    ['subject empty', { ...good, subject: '  ' }],
    ['text empty', { ...good, text: '' }],
  ])('rejects: %s', (_n, mail) => {
    expect(() => assertMail(mail)).toThrow(MailError)
  })
  it('rejects a sender with CR/LF', () => {
    expect(() => assertMail(good, 'a@example.com\r\nBcc: x@y.de')).toThrow(MailError)
    expect(() => assertMail(good, 'kaputt')).toThrow(MailError)
  })
  it('the memory adapter applies the same rules', async () => {
    const m = createMemoryMailer()
    await expect(m.sendMail({ ...good, subject: 'x\ny' })).rejects.toMatchObject({ code: 'invalid' })
    expect(m.outbox).toHaveLength(0)
  })
})

describe('Templates', () => {
  it('escapeHtml', () => {
    expect(escapeHtml('<a href="x" onclick=\'y\'>&</a>')).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
  it('Link is built only from BASE_URL, token in the fragment', () => {
    const mail = resetPasswordMail('a@example.com', 'https://mcp.example.com', 'tok123')
    expect(mail.text).toContain('https://mcp.example.com/reset-password#token=tok123')
    expect(mail.html).toContain('href="https://mcp.example.com/reset-password#token=tok123"')
  })
  it('Path and query of BASE_URL do not flow into the link', () => {
    expect(buildLink('https://mcp.example.com/sub?x=1#h', '/reset-password', { token: 'a' })).toBe('https://mcp.example.com/reset-password#token=a')
  })
  it('a malicious token breaks neither link nor HTML', () => {
    const mail = resetPasswordMail('a@example.com', 'https://mcp.example.com', '"><script>alert(1)</script>&x=1')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('#token=%22%3E%3Cscript%3E')
    expect(mail.html!.match(/<a /g)).toHaveLength(1)
    expect(mail.text.split('\n').find(l => l.includes('reset-password'))).not.toMatch(/\s/)
    expect(() => assertMail(mail)).not.toThrow()
  })
  it('Mail is German, states the validity and passes validation', () => {
    const mail = resetPasswordMail('a@example.com', 'https://mcp.example.com', 't')
    expect(mail.subject).toBe('Passwort zurücksetzen')
    expect(mail.text).toContain('15 Minuten')
    expect(() => assertMail(mail, 'x@example.com')).not.toThrow()
  })
})

describe('No-op-Adapter', () => {
  it('is not enabled and sends nothing', async () => {
    const m = createNoopMailer()
    expect(m.enabled).toBe(false)
    await expect(m.sendMail(good)).rejects.toMatchObject({ code: 'disabled' })
  })
  it('createMailer without SMTP configuration returns the no-op adapter', () => {
    expect(createMailer({ smtp: undefined, mailFrom: undefined }).enabled).toBe(false)
  })
  it('createMailer with SMTP is enabled', () => {
    const smtp = { host: 'mail.example.com', port: 465, secure: true, user: undefined, pass: undefined }
    expect(createMailer({ smtp, mailFrom: 'a@example.com' }).enabled).toBe(true)
  })
})

describe('Empfaengerlimit', () => {
  it('limits per recipient (case-insensitive) in the window and releases again afterwards', async () => {
    let t = 0
    const inner = createMemoryMailer()
    const m = withRecipientLimit(inner, { max: 2, windowMs: 1000, now: () => t })
    await m.sendMail(good)
    await m.sendMail({ ...good, to: 'A@Example.com' })
    await expect(m.sendMail(good)).rejects.toMatchObject({ code: 'rate_limited' })
    await m.sendMail({ ...good, to: 'other@example.com' })
    t = 1500
    await m.sendMail(good)
    expect(inner.outbox).toHaveLength(4)
  })
  it('invalid mails consume no quota', async () => {
    const m = withRecipientLimit(createMemoryMailer(), { max: 1, windowMs: 1000 })
    await expect(m.sendMail({ ...good, subject: 'a\nb' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(m.sendMail(good)).resolves.toBeUndefined()
  })
})

describe('trySendMail', () => {
  it('never throws and logs only the code, never address, subject or text', async () => {
    const m = createMemoryMailer()
    m.failWith = new MailError('transport', 'smtp://user:SECRET@host a@example.com')
    const log = vi.fn()
    expect(await trySendMail(m, { ...good, text: 'LEAKY-TOKEN' }, 'Test', log)).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]![0])
    expect(line).toContain('transport')
    for (const leak of ['SECRET', 'a@example.com', 'LEAKY-TOKEN', 'Hallo']) expect(line).not.toContain(leak)
  })
  it('returns true on success', async () => {
    const m = createMemoryMailer()
    expect(await trySendMail(m, good, 'Test', () => {})).toBe(true)
    expect(m.outbox).toHaveLength(1)
  })
})

describe('Password reset hook (Better Auth)', () => {
  const base = { baseUrl: 'https://mcp.example.com', secret: 's'.repeat(40), allowedOrigins: [], rateLimitEnabled: false, trustProxy: 0, countUsers: async () => 1 }
  const hookOf = (o: ReturnType<typeof buildAuthOptions>) => (o.emailAndPassword as { sendResetPassword?: (d: { user: { email: string }, token: string }) => Promise<void> }).sendResetPassword

  it('without an active mailer the reset is not switched on', () => {
    expect(hookOf(buildAuthOptions(base))).toBeUndefined()
    expect(hookOf(buildAuthOptions({ ...base, mailer: createNoopMailer() }))).toBeUndefined()
  })
  it('with mailer: short token expiry, sessions are ended, min. 12 characters', () => {
    const o = buildAuthOptions({ ...base, mailer: createMemoryMailer() })
    expect(o.emailAndPassword).toMatchObject({ minPasswordLength: 12, resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true })
  })
  it('sends a mail with a link from BASE_URL and never logs the token', async () => {
    const mailer = createMemoryMailer()
    const logs: string[] = []
    const spies = (['log', 'error', 'warn', 'info'] as const).map(k => vi.spyOn(console, k).mockImplementation((...a) => { logs.push(a.join(' ')) }))
    try {
      const hook = hookOf(buildAuthOptions({ ...base, mailer }))!
      await hook({ user: { email: 'a@example.com' }, token: 'SUPER-LEAKY-TOKEN' })
      await vi.waitFor(() => expect(mailer.outbox).toHaveLength(1))
      mailer.failWith = new MailError('transport')
      await hook({ user: { email: 'b@example.com' }, token: 'SUPER-LEAKY-TOKEN-2' })
      await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0))
    } finally {
      spies.forEach(s => s.mockRestore())
    }
    expect(mailer.outbox[0]!.text).toContain('https://mcp.example.com/reset-password#token=SUPER-LEAKY-TOKEN')
    expect(logs.join('\n')).not.toContain('LEAKY-TOKEN')
    expect(logs.join('\n')).not.toContain('example.com')
  })
  it('the hook does not await sending (no timing oracle for existing addresses)', async () => {
    let release!: () => void
    const slow = { enabled: true, sendMail: () => new Promise<void>((r) => { release = r }) }
    const hook = hookOf(buildAuthOptions({ ...base, mailer: slow }))!
    await expect(Promise.race([hook({ user: { email: 'a@example.com' }, token: 't' }).then(() => 'done'), new Promise(r => setTimeout(() => r('hang'), 200))])).resolves.toBe('done')
    release()
  })
})
