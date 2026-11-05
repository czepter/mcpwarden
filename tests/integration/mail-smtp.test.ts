import { afterEach, describe, expect, it } from 'vitest'
import { createSmtpMailer } from '../../server/mail/smtp'
import { MailError } from '../../server/mail/types'
import type { SmtpConfig } from '../../server/utils/config'
import { readable, startFakeSmtp, type FakeSmtp, type FakeSmtpOptions } from '../helpers/fake-smtp'

const FROM = 'mcpwarden <noreply@example.com>'
const mail = { to: 'target@example.com', subject: 'Subject', text: 'Hello world', html: '<p>Hello world</p>' }
// Test only: the built-in certificate set of smtp-server is self-signed.
const tls = { rejectUnauthorized: false }
const fast = { connectionTimeoutMs: 400, greetingTimeoutMs: 400, socketTimeoutMs: 400, sendTimeoutMs: 1500, backoffMs: 10 }

const servers: FakeSmtp[] = []
async function fake(o: FakeSmtpOptions = {}) {
  const s = await startFakeSmtp(o)
  servers.push(s)
  return s
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => s.close()))
})

function cfg(s: FakeSmtp, extra: Partial<SmtpConfig> & { pass?: string } = {}): SmtpConfig {
  const c = { host: s.host, port: s.port, secure: false, user: undefined, ...extra } as SmtpConfig
  Object.defineProperty(c, 'pass', { value: extra.pass, enumerable: false })
  return c
}

describe('SMTP adapter against fake server', () => {
  it('sends plaintext + HTML with correct headers (loopback without TLS)', async () => {
    const s = await fake()
    await createSmtpMailer(cfg(s), FROM, { ...fast, tls }).sendMail(mail)
    expect(s.mails).toHaveLength(1)
    const m = s.mails[0]!
    expect(m.to).toEqual(['target@example.com'])
    expect(m.from).toBe('noreply@example.com')
    const r = readable(m)
    expect(r).toMatch(/^To: target@example\.com\r?$/m)
    expect(r).toMatch(/^Subject: Subject\r?$/m)
    expect(r).toContain('text/plain')
    expect(r).toContain('text/html')
    expect(r).toContain('Hello world')
  })

  it('smtps (implicit TLS) with login', async () => {
    const s = await fake({ secure: true, auth: { user: 'u@x', pass: 'pw/1:2' } })
    await createSmtpMailer(cfg(s, { secure: true, user: 'u@x', pass: 'pw/1:2' }), FROM, { ...fast, tls }).sendMail(mail)
    expect(s.mails).toHaveLength(1)
    expect(s.mails[0]).toMatchObject({ secure: true, user: 'u@x' })
  })

  it('STARTTLS is mandatory outside loopback: server without STARTTLS is rejected, nothing is sent in plaintext', async () => {
    const s = await fake({ host: '127.0.0.2', auth: { user: 'u', pass: 'p' } })
    const logs: string[] = []
    const mailer = createSmtpMailer(cfg(s, { user: 'u', pass: 'p' }), FROM, { ...fast, retries: 0, tls, log: m => logs.push(m) })
    await expect(mailer.sendMail(mail)).rejects.toMatchObject({ code: 'transport' })
    expect(s.mails).toHaveLength(0)
    expect(s.authAttempts).toBe(0)
  })

  it('STARTTLS outside loopback: upgrade, then login and sending over TLS', async () => {
    const s = await fake({ host: '127.0.0.2', starttls: true, auth: { user: 'u', pass: 'p' } })
    await createSmtpMailer(cfg(s, { user: 'u', pass: 'p' }), FROM, { ...fast, tls }).sendMail(mail)
    expect(s.mails).toHaveLength(1)
    expect(s.mails[0]!.secure).toBe(true)
  })

  it('wrong credentials: one attempt (no retry), error without password in the log', async () => {
    const s = await fake({ auth: { user: 'u', pass: 'correct' } })
    const logs: string[] = []
    const mailer = createSmtpMailer(cfg(s, { user: 'u', pass: 'SECRET-WRONG' }), FROM, { ...fast, tls, log: m => logs.push(m) })
    const e = await mailer.sendMail(mail).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(MailError)
    expect((e as MailError).code).toBe('transport')
    expect(s.authAttempts).toBe(1)
    expect(s.mails).toHaveLength(0)
    expect(logs).toHaveLength(1)
    const all = logs.join('\n') + String((e as Error).message)
    for (const leak of ['SECRET-WRONG', 'correct', 'target@example.com', 'Hello world']) expect(all).not.toContain(leak)
    expect(all).toContain('EAUTH')
  })

  it('Connection timeout: server never greets, limited retries, then error', async () => {
    const s = await fake({ silent: true })
    const started = Date.now()
    await expect(createSmtpMailer(cfg(s), FROM, { ...fast, retries: 1, tls, log: () => {} }).sendMail(mail)).rejects.toMatchObject({ code: 'transport' })
    expect(s.connections).toBe(2) // 1 attempt + 1 retry
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('Send timeout: server never answers DATA', async () => {
    const s = await fake({ hangOnData: true })
    const started = Date.now()
    await expect(createSmtpMailer(cfg(s), FROM, { ...fast, retries: 0, sendTimeoutMs: 500, socketTimeoutMs: 5000, tls, log: () => {} }).sendMail(mail)).rejects.toMatchObject({ code: 'transport' })
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('transient error (451) is retried and succeeds', async () => {
    const s = await fake({ tempFailFirst: 1 })
    await createSmtpMailer(cfg(s), FROM, { ...fast, tls }).sendMail(mail)
    expect(s.dataAttempts).toBe(2)
    expect(s.mails).toHaveLength(1)
  })

  it('permanent error (550) is not retried', async () => {
    const s = await fake({ rejectRcpt: 550 })
    await expect(createSmtpMailer(cfg(s), FROM, { ...fast, tls, log: () => {} }).sendMail(mail)).rejects.toMatchObject({ code: 'transport' })
    expect(s.connections).toBe(1)
  })

  it('Retries are bounded (default: at most 3 attempts)', async () => {
    const s = await fake({ tempFailFirst: 99 })
    await expect(createSmtpMailer(cfg(s), FROM, { ...fast, tls, log: () => {} }).sendMail(mail)).rejects.toMatchObject({ code: 'transport' })
    expect(s.dataAttempts).toBe(3)
  })

  it('Header injection is rejected before any connection', async () => {
    const s = await fake()
    const mailer = createSmtpMailer(cfg(s), FROM, { ...fast, tls })
    for (const bad of [
      { ...mail, subject: 'Hi\r\nBcc: boese@example.com' },
      { ...mail, to: 'target@example.com\r\nBcc: evil@example.com' },
      { ...mail, to: 'target@example.com, evil@example.com' },
    ]) await expect(mailer.sendMail(bad)).rejects.toMatchObject({ code: 'invalid' })
    expect(s.connections).toBe(0)
    await expect(createSmtpMailer(cfg(s), 'a@example.com\r\nBcc: x@y.de', fast).sendMail(mail)).rejects.toMatchObject({ code: 'invalid' })
    expect(s.connections).toBe(0)
  })

  it('unreachable server: error instead of crash', async () => {
    const s = await fake()
    const c = cfg(s)
    await s.close()
    servers.length = 0
    await expect(createSmtpMailer(c, FROM, { ...fast, retries: 1, tls, log: () => {} }).sendMail(mail)).rejects.toMatchObject({ code: 'transport' })
  })
})
