import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PublicConfig } from '../../shared/api-types'
import { readable, startFakeSmtp, type FakeSmtp } from '../helpers/fake-smtp'
import { ADMIN, api, createInstance, createUser, signUpFirstAdmin, startServer, type TestInstance, type TestServer } from './harness'

const USER = { name: 'Bea', email: 'bea@example.com', password: 'bea-altes-passwort-1' }
const NEW_PW = 'bea-neues-passwort-2'
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

describe('Passwort-Reset mit SMTP (Fake-Server)', () => {
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

  it('/api/public-config meldet mail: true (ohne Sitzung)', async () => {
    const r = await api(srv.url).request('/api/public-config')
    expect(r.status).toBe(200)
    expect(r.json satisfies PublicConfig).toEqual({ mail: true, registrationOpen: false })
  })

  it('Antwort ist fuer bekannte und unbekannte Adressen identisch; nur die bekannte bekommt eine Mail', async () => {
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

  it('Link zeigt auf BASE_URL (auch bei gefaelschtem Host) und das Token steht im Fragment', async () => {
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

  it('redirectTo auf fremde Origin wird abgelehnt', async () => {
    const r = await api(srv.url, '203.0.113.25').request('/api/auth/request-password-reset', { body: { email: USER.email, redirectTo: 'https://evil.example/x' } })
    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(r.status).toBeLessThan(500)
  })

  it('Zuruecksetzen: zu kurzes Passwort 400, gueltiges 200, Token nur einmal, altes Passwort ungueltig, Sitzungen beendet', async () => {
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

    expect((await anon.request('/api/auth/reset-password', { body: { token, newPassword: 'noch-ein-passwort-3' } })).status).toBe(400)
    expect((await anon.request('/api/auth/sign-in/email', { body: { email: USER.email, password: USER.password } })).status).toBe(401)
    expect((await anon.request('/api/auth/sign-in/email', { body: { email: USER.email, password: NEW_PW } })).status).toBe(200)
    expect((await bea.request('/api/auth/get-session')).json?.user).toBeUndefined()
  })

  it('unbekanntes Token: 400', async () => {
    const r = await api(srv.url, '203.0.113.32').request('/api/auth/reset-password', { body: { token: 'gibtsnicht', newPassword: NEW_PW } })
    expect(r.status).toBe(400)
  })

  it('Server-Log enthaelt weder Token noch Empfaengeradresse noch Passwort', async () => {
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

describe('Passwort-Reset: Fehlerpfade und Abschaltung', () => {
  let inst: TestInstance
  beforeAll(async () => { inst = await createInstance() })
  afterAll(async () => { await inst?.cleanup() })

  it('SMTP nicht erreichbar: Anfrage antwortet normal, Server laeuft weiter, Log ohne Adresse', async () => {
    const dead = await startFakeSmtp()
    const port = dead.port
    await dead.close()
    const srv = await startServer(inst, { env: { SMTP_URL: `smtp://127.0.0.1:${port}`, MAIL_FROM: 'noreply@example.com' } })
    try {
      const admin = await signUpFirstAdmin(srv)
      await createUser(admin, USER)
      const r = await api(srv.url, '203.0.113.40').request('/api/auth/request-password-reset', { body: { email: USER.email } })
      expect(r.status).toBe(200)
      await wait(() => (srv.logs().includes('mail: Passwort-Reset nicht gesendet') ? true : undefined), 15_000)
      expect((await fetch(`${srv.url}/readyz`)).status).toBe(200)
      expect(srv.logs()).not.toContain(USER.email)
    } finally {
      await srv.stop()
    }
  })

  it('ohne SMTP_URL: mail: false, Reset ist abgeschaltet, nichts aendert sich', async () => {
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
