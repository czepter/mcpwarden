import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PublicConfig } from '../../shared/api-types'
import { readable, startFakeSmtp, type FakeSmtp } from '../helpers/fake-smtp'
import { ADMIN, api, createInstance, createUser, signUpFirstAdmin, startServer, type TestInstance, type TestServer } from './harness'

const USER = { name: 'Bea', email: 'bea@example.com', password: 'bea-altes-password-1' }
const NEW_PW = 'bea-neues-password-2'
const wait = async <T>(fn: () => T | undefined, ms = 8000): Promise<T> => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = fn()
    if (v !== undefined) return v
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('Zeitueberschreitung')
}
const tokenOf = (smtp: FakeSmtp, to: string) => {
  const m = smtp.mails.find(x => x.to.includes(to))
  return m ? /reset-password#token=([A-Za-z0-9_-]+)/.exec(readable(m))?.[1] : undefined
}

describe('Password reset with SMTP (fake server)', () => {
  let inst: TestInstance
  let srv: TestServer
  let smtp: FakeSmtp

  beforeAll(async () => {
    inst = await createInstance()
    smtp = await startFakeSmtp()
    srv = await startServer(inst, { env: { SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'mcpwarden <noreply@example.com>' } })
    const admin = await signUpFirstAdmin(srv)
    await createUser(admin, USER)
  })
  afterAll(async () => {
    await srv?.stop()
    await smtp?.close()
    await inst?.cleanup()
  })

  it('/api/public-config reports mail: true (without a session)', async () => {
    const r = await api(srv.url).request('/api/public-config')
    expect(r.status).toBe(200)
    expect(r.json satisfies PublicConfig).toEqual({ mail: true, registrationOpen: false })
  })

  it('Response is identical for known and unknown addresses; only the known one gets a mail', async () => {
    const known = await api(srv.url, '203.0.113.21').request('/api/auth/request-password-reset', { body: { email: USER.email } })
    const unknown = await api(srv.url, '203.0.113.22').request('/api/auth/request-password-reset', { body: { email: 'niemand@example.com' } })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(known.status)
    expect(unknown.json).toEqual(known.json)
    await wait(() => (smtp.mails.length ? true : undefined))
    await new Promise(r => setTimeout(r, 300))
    expect(smtp.mails).toHaveLength(1)
    expect(smtp.mails[0]!.to).toEqual([USER.email])
  })

  it('Link points to BASE_URL (also with a forged host) and the token is in the fragment', async () => {
    const r = await api(srv.url, '203.0.113.23').request('/api/auth/request-password-reset', { body: { email: ADMIN.email } })
    expect(r.status).toBe(200)
    await wait(() => smtp.mails.find(m => m.to.includes(ADMIN.email)))
    const raw = readable(smtp.mails.find(m => m.to.includes(ADMIN.email))!)
    expect(raw).toContain(`${srv.url}/reset-password#token=`)
    expect(raw).not.toContain('evil.example')
    const t = await fetch(`${srv.url}/api/auth/request-password-reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': srv.url, 'x-forwarded-host': 'evil.example', 'x-forwarded-for': '203.0.113.24' },
      body: JSON.stringify({ email: USER.email }),
    })
    expect(t.status).toBe(200)
    await wait(() => (smtp.mails.filter(m => m.to.includes(USER.email)).length >= 2 ? true : undefined))
    for (const m of smtp.mails) expect(readable(m)).not.toContain('evil.example')
  })

  it('redirectTo to a foreign origin is rejected', async () => {
    const r = await api(srv.url, '203.0.113.25').request('/api/auth/request-password-reset', { body: { email: USER.email, redirectTo: 'https://evil.example/x' } })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  })

  it('Reset: too short password 400, valid 200, token only once, old password invalid, sessions ended', async () => {
    const bea = api(srv.url, '203.0.113.30')
    expect((await bea.request('/api/auth/sign-in/email', { body: { email: USER.email, password: USER.password } })).status).toBe(200)
    expect((await bea.request('/api/auth/get-session')).json?.user?.email).toBe(USER.email)

    const token = tokenOf(smtp, USER.email)
    expect(token).toBeTruthy()
    const anon = api(srv.url, '203.0.113.31')
    const short = await anon.request('/api/auth/reset-password', { body: { token, newPassword: '12345678901' } })
    expect(short.status).toBe(400)
    const ok = await anon.request('/api/auth/reset-password', { body: { token, newPassword: NEW_PW } })
    expect(ok.status).toBe(200)

    expect((await anon.request('/api/auth/reset-password', { body: { token, newPassword: 'yet-another-password-3' } })).status).toBe(400)
    expect((await anon.request('/api/auth/sign-in/email', { body: { email: USER.email, password: USER.password } })).status).toBe(401)
    expect((await anon.request('/api/auth/sign-in/email', { body: { email: USER.email, password: NEW_PW } })).status).toBe(200)
    expect((await bea.request('/api/auth/get-session')).json?.user).toBeUndefined()
  })

  it('unknown token: 400', async () => {
    const r = await api(srv.url, '203.0.113.32').request('/api/auth/reset-password', { body: { token: 'gibtsnicht', newPassword: NEW_PW } })
    expect(r.status).toBe(400)
  })

  it('Server log contains neither token nor recipient address nor password', async () => {
    const logs = srv.logs()
    for (const m of smtp.mails) {
      const t = /reset-password#token=([A-Za-z0-9_-]+)/.exec(readable(m))?.[1]
      expect(t).toBeTruthy()
      expect(logs).not.toContain(t!)
    }
    expect(logs).not.toContain(NEW_PW)
    expect(logs).not.toContain(USER.email)
  })
})

describe('Password reset: error paths and shutdown', () => {
  let inst: TestInstance
  beforeAll(async () => { inst = await createInstance() })
  afterAll(async () => { await inst?.cleanup() })

  it('SMTP unreachable: request answers normally, server keeps running, log without address', async () => {
    const dead = await startFakeSmtp()
    const port = dead.port
    await dead.close()
    const srv = await startServer(inst, { env: { SMTP_URL: `smtp://127.0.0.1:${port}`, MAIL_FROM: 'noreply@example.com' } })
    try {
      const admin = await signUpFirstAdmin(srv)
      await createUser(admin, USER)
      const r = await api(srv.url, '203.0.113.40').request('/api/auth/request-password-reset', { body: { email: USER.email } })
      expect(r.status).toBe(200)
      await wait(() => (srv.logs().includes('mail: password reset not sent') ? true : undefined), 15_000)
      expect((await fetch(`${srv.url}/readyz`)).status).toBe(200)
      expect(srv.logs()).not.toContain(USER.email)
    } finally {
      await srv.stop()
    }
  })

  it('without SMTP_URL: mail: false, reset is switched off, nothing changes', async () => {
    const srv = await startServer(inst, { env: { SMTP_URL: undefined, MAIL_FROM: undefined } })
    try {
      const cfg = await api(srv.url).request('/api/public-config')
      expect(cfg.json).toEqual({ mail: false, registrationOpen: false })
      const r = await api(srv.url, '203.0.113.41').request('/api/auth/request-password-reset', { body: { email: USER.email } })
      expect(r.status).toBe(400)
      expect(r.json).toMatchObject({ code: 'RESET_PASSWORD_DISABLED' })
    } finally {
      await srv.stop()
    }
  })
})
