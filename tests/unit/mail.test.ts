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

describe('Header-Injection-Schutz', () => {
  it('nimmt eine saubere Mail an', () => {
    expect(() => assertMail(good, 'mcpwarden <noreply@example.com>')).not.toThrow()
  })
  it.each([
    ['to mit LF', { ...good, to: 'a@example.com\nBcc: x@y.de' }],
    ['to mit CRLF', { ...good, to: 'a@example.com\r\nBcc: x@y.de' }],
    ['to mit Komma-Liste', { ...good, to: 'a@example.com,b@example.com' }],
    ['to mit Anzeigename', { ...good, to: 'Eve <a@example.com>' }],
    ['to leer', { ...good, to: '' }],
    ['Betreff mit LF', { ...good, subject: 'Hi\nBcc: x@y.de' }],
    ['Betreff mit CR', { ...good, subject: 'Hi\rBcc: x@y.de' }],
    ['Betreff mit U+2028', { ...good, subject: 'Hi\u2028Bcc: x@y.de' }],
    ['Betreff leer', { ...good, subject: '  ' }],
    ['Text leer', { ...good, text: '' }],
  ])('lehnt ab: %s', (_n, mail) => {
    expect(() => assertMail(mail)).toThrow(MailError)
  })
  it('lehnt Absender mit CR/LF ab', () => {
    expect(() => assertMail(good, 'a@example.com\r\nBcc: x@y.de')).toThrow(MailError)
    expect(() => assertMail(good, 'kaputt')).toThrow(MailError)
  })
  it('der Memory-Adapter prueft dieselben Regeln', async () => {
    const m = createMemoryMailer()
    await expect(m.sendMail({ ...good, subject: 'x\ny' })).rejects.toMatchObject({ code: 'invalid' })
    expect(m.outbox).toHaveLength(0)
  })
})

describe('Templates', () => {
  it('escapeHtml', () => {
    expect(escapeHtml('<a href="x" onclick=\'y\'>&</a>')).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;')
  })
  it('Link entsteht nur aus BASE_URL, Token im Fragment', () => {
    const mail = resetPasswordMail('a@example.com', 'https://mcp.example.com', 'tok123')
    expect(mail.text).toContain('https://mcp.example.com/reset-password#token=tok123')
    expect(mail.html).toContain('href="https://mcp.example.com/reset-password#token=tok123"')
  })
  it('Pfad und Query der BASE_URL fliessen nicht in den Link', () => {
    expect(buildLink('https://mcp.example.com/sub?x=1#h', '/reset-password', { token: 'a' })).toBe('https://mcp.example.com/reset-password#token=a')
  })
  it('ein boesartiges Token bricht weder Link noch HTML auf', () => {
    const mail = resetPasswordMail('a@example.com', 'https://mcp.example.com', '"><script>alert(1)</script>&x=1')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('#token=%22%3E%3Cscript%3E')
    expect(mail.html!.match(/<a /g)).toHaveLength(1)
    expect(mail.text.split('\n').find(l => l.includes('reset-password'))).not.toMatch(/\s/)
    expect(() => assertMail(mail)).not.toThrow()
  })
  it('Mail ist deutsch, nennt die Gueltigkeit und passiert die Validierung', () => {
    const mail = resetPasswordMail('a@example.com', 'https://mcp.example.com', 't')
    expect(mail.subject).toBe('Passwort zurücksetzen')
    expect(mail.text).toContain('15 Minuten')
    expect(() => assertMail(mail, 'x@example.com')).not.toThrow()
  })
})

describe('No-op-Adapter', () => {
  it('ist nicht enabled und sendet nichts', async () => {
    const m = createNoopMailer()
    expect(m.enabled).toBe(false)
    await expect(m.sendMail(good)).rejects.toMatchObject({ code: 'disabled' })
  })
  it('createMailer ohne SMTP-Konfiguration liefert den No-op-Adapter', () => {
    expect(createMailer({ smtp: undefined, mailFrom: undefined }).enabled).toBe(false)
  })
  it('createMailer mit SMTP ist enabled', () => {
    const smtp = { host: 'mail.example.com', port: 465, secure: true, user: undefined, pass: undefined }
    expect(createMailer({ smtp, mailFrom: 'a@example.com' }).enabled).toBe(true)
  })
})

describe('Empfaengerlimit', () => {
  it('begrenzt je Empfaenger (case-insensitive) im Fenster und gibt danach wieder frei', async () => {
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
  it('ungueltige Mails verbrauchen kein Kontingent', async () => {
    const m = withRecipientLimit(createMemoryMailer(), { max: 1, windowMs: 1000 })
    await expect(m.sendMail({ ...good, subject: 'a\nb' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(m.sendMail(good)).resolves.toBeUndefined()
  })
})

describe('trySendMail', () => {
  it('wirft nie und loggt nur den Code, nie Adresse, Betreff oder Text', async () => {
    const m = createMemoryMailer()
    m.failWith = new MailError('transport', 'smtp://user:SECRET@host a@example.com')
    const log = vi.fn()
    expect(await trySendMail(m, { ...good, text: 'GEHEIMES-TOKEN' }, 'Test', log)).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    const line = String(log.mock.calls[0]![0])
    expect(line).toContain('transport')
    for (const leak of ['SECRET', 'a@example.com', 'GEHEIMES-TOKEN', 'Hallo']) expect(line).not.toContain(leak)
  })
  it('liefert true bei Erfolg', async () => {
    const m = createMemoryMailer()
    expect(await trySendMail(m, good, 'Test', () => {})).toBe(true)
    expect(m.outbox).toHaveLength(1)
  })
})

describe('Passwort-Reset-Hook (Better Auth)', () => {
  const base = { baseUrl: 'https://mcp.example.com', secret: 's'.repeat(40), allowedOrigins: [], rateLimitEnabled: false, trustProxy: 0, countUsers: async () => 1 }
  const hookOf = (o: ReturnType<typeof buildAuthOptions>) => (o.emailAndPassword as { sendResetPassword?: (d: { user: { email: string }, token: string }) => Promise<void> }).sendResetPassword

  it('ohne aktiven Mailer ist der Reset nicht eingeschaltet', () => {
    expect(hookOf(buildAuthOptions(base))).toBeUndefined()
    expect(hookOf(buildAuthOptions({ ...base, mailer: createNoopMailer() }))).toBeUndefined()
  })
  it('mit Mailer: kurzes Token-Ablaufdatum, Sitzungen werden beendet, min. 12 Zeichen', () => {
    const o = buildAuthOptions({ ...base, mailer: createMemoryMailer() })
    expect(o.emailAndPassword).toMatchObject({ minPasswordLength: 12, resetPasswordTokenExpiresIn: 900, revokeSessionsOnPasswordReset: true })
  })
  it('sendet eine Mail mit Link aus BASE_URL und loggt das Token nie', async () => {
    const mailer = createMemoryMailer()
    const logs: string[] = []
    const spies = (['log', 'error', 'warn', 'info'] as const).map(k => vi.spyOn(console, k).mockImplementation((...a) => { logs.push(a.join(' ')) }))
    try {
      const hook = hookOf(buildAuthOptions({ ...base, mailer }))!
      await hook({ user: { email: 'a@example.com' }, token: 'SUPER-GEHEIMES-TOKEN' })
      await vi.waitFor(() => expect(mailer.outbox).toHaveLength(1))
      mailer.failWith = new MailError('transport')
      await hook({ user: { email: 'b@example.com' }, token: 'SUPER-GEHEIMES-TOKEN-2' })
      await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0))
    } finally {
      spies.forEach(s => s.mockRestore())
    }
    expect(mailer.outbox[0]!.text).toContain('https://mcp.example.com/reset-password#token=SUPER-GEHEIMES-TOKEN')
    expect(logs.join('\n')).not.toContain('GEHEIMES-TOKEN')
    expect(logs.join('\n')).not.toContain('example.com')
  })
  it('der Hook wartet den Versand nicht ab (kein Timing-Orakel fuer existierende Adressen)', async () => {
    let release!: () => void
    const slow = { enabled: true, sendMail: () => new Promise<void>((r) => { release = r }) }
    const hook = hookOf(buildAuthOptions({ ...base, mailer: slow }))!
    await expect(Promise.race([hook({ user: { email: 'a@example.com' }, token: 't' }).then(() => 'done'), new Promise(r => setTimeout(() => r('hang'), 200))])).resolves.toBe('done')
    release()
  })
})
