// Einladungsmails und Statusbenachrichtigungen gegen den echten Server mit Fake-SMTP und Fake-Upstream.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { InviteCreated, MeSettings, UpstreamDetail, UpstreamTestResult } from '#shared/api-types'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { readable, startFakeSmtp, type FakeSmtp } from '../helpers/fake-smtp'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

const PW = 'passwort-1234567'
const SECRET = 'sk-notify-secret-value-123'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until<T>(fn: () => T | undefined, ms = 8000): Promise<T> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = fn()
    if (v !== undefined) return v
    await sleep(50)
  }
  throw new Error('Zeitueberschreitung')
}
const mailsTo = (smtp: FakeSmtp, to: string) => smtp.mails.filter(m => m.to.includes(to))
const statusMailsTo = (smtp: FakeSmtp, to: string) => mailsTo(smtp, to).filter(m => /^Subject: mcpwarden:/m.test(readable(m)))

async function login(srv: TestServer, email: string, ip: string): Promise<ApiClient> {
  const c = api(srv.url, ip)
  const r = await c.request('/api/auth/sign-in/email', { body: { email, password: PW } })
  expect(r.status, r.text).toBe(200)
  return c
}

describe('Mailbenachrichtigungen mit SMTP', () => {
  let inst: TestInstance
  let srv: TestServer
  let smtp: FakeSmtp
  let fake: FakeHttp
  let fakeB: FakeHttp
  let admin: ApiClient
  let a: ApiClient
  let b: ApiClient
  let upA: UpstreamDetail
  let upB: UpstreamDetail

  async function mkUpstream(c: ApiClient, f: FakeHttp, slug: string, name: string): Promise<UpstreamDetail> {
    const r = await c.request('/api/upstreams', { body: { name, slug, type: 'http', url: f.url, authType: 'bearer' } })
    expect(r.status, r.text).toBe(201)
    const id = (r.json as UpstreamDetail).id
    expect((await c.request(`/api/upstreams/${id}/secret`, { method: 'PUT', body: { kind: 'bearer', value: SECRET } })).status).toBe(200)
    f.requireHeader('authorization', `Bearer ${SECRET}`)
    const t = (await c.request(`/api/upstreams/${id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult
    expect(t.ok).toBe(true)
    return (await c.request(`/api/upstreams/${id}`)).json as UpstreamDetail
  }
  const test = async (c: ApiClient, id: string) => (await c.request(`/api/upstreams/${id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult

  beforeAll(async () => {
    inst = await createInstance()
    smtp = await startFakeSmtp()
    fake = await startFakeHttp()
    fakeB = await startFakeHttp()
    srv = await startServer(inst, { env: { SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'mcpwarden <noreply@example.com>', MAIL_NOTIFY_WINDOW_MIN: '60' } })
    admin = await signUpFirstAdmin(srv)
    expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })).status).toBe(200)
    await createUser(admin, { name: 'Anna', email: 'anna@example.com', password: PW })
    await createUser(admin, { name: 'Bert', email: 'bert@example.com', password: PW })
    a = await login(srv, 'anna@example.com', '198.51.100.11')
    b = await login(srv, 'bert@example.com', '198.51.100.12')
    upA = await mkUpstream(a, fake, 'wiki', 'Anna <b>Wiki</b>')
    upB = await mkUpstream(b, fakeB, 'tickets', 'Berts Tickets')
  })
  afterAll(async () => {
    await srv?.stop()
    await smtp?.close()
    await fake?.close()
    await fakeB?.close()
    await inst?.cleanup()
  })

  describe('Einladungsmail', () => {
    it('sendet den Link an die gebundene Adresse; der Admin bekommt ihn weiterhin; das Token steht nicht im Log', async () => {
      const r = await admin.request('/api/admin/invites', { body: { email: 'neu@example.com', sendMail: true } })
      expect(r.status, r.text).toBe(201)
      const inv = r.json as InviteCreated
      expect(inv.mailQueued).toBe(true)
      expect(inv.link).toMatch(/\/invite\/[A-Za-z0-9_-]{20,}$/)
      const m = await until(() => mailsTo(smtp, 'neu@example.com')[0])
      const raw = readable(m)
      expect(raw).toContain(inv.link)
      expect(raw).toContain(`${srv.url}/invite/`)
      const token = inv.link.split('/invite/')[1]!
      expect(srv.logs()).not.toContain(token)
    })
    it('ohne sendMail kein Versand; sendMail ohne Adresse oder mit Nicht-Boolean ist 422', async () => {
      const before = smtp.mails.length
      expect((await admin.request('/api/admin/invites', { body: { email: 'still@example.com' } })).status).toBe(201)
      const noMail = await admin.request('/api/admin/invites', { body: { sendMail: true } })
      expect(noMail.status).toBe(422)
      expect(noMail.json.data.field).toBe('sendMail')
      expect((await admin.request('/api/admin/invites', { body: { email: 'x@example.com', sendMail: 'ja' } })).status).toBe(422)
      await sleep(300)
      expect(smtp.mails.length).toBe(before)
    })
    it('Header-Injection in der Adresse wird abgelehnt, nichts wird gesendet', async () => {
      const before = smtp.mails.length
      const r = await admin.request('/api/admin/invites', { body: { email: 'a@example.com\r\nBcc: evil@example.com', sendMail: true } })
      expect(r.status).toBe(422)
      await sleep(300)
      expect(smtp.mails.length).toBe(before)
    })
    it('Empfaengerlimit gilt: ab der vierten Einladung je Adresse und Stunde keine Mail, das Anlegen klappt trotzdem', async () => {
      for (let i = 0; i < 4; i++) {
        const r = await admin.request('/api/admin/invites', { body: { email: 'viel@example.com', sendMail: true } })
        expect(r.status).toBe(201)
      }
      await until(() => (mailsTo(smtp, 'viel@example.com').length >= 3 ? true : undefined))
      await sleep(500)
      expect(mailsTo(smtp, 'viel@example.com')).toHaveLength(3)
    })
    it('Nicht-Admins koennen keine Einladungsmail ausloesen', async () => {
      const before = smtp.mails.length
      expect((await a.request('/api/admin/invites', { body: { email: 'q@example.com', sendMail: true } })).status).toBe(403)
      expect(smtp.mails.length).toBe(before)
    })
  })

  describe('Statusbenachrichtigung', () => {
    it('Standard ist an; PATCH ist validiert und wirkt nur auf den eigenen Nutzer', async () => {
      expect((await a.request('/api/me/settings')).json satisfies MeSettings).toEqual({ notifyStatusMail: true })
      expect((await a.request('/api/me/settings', { method: 'PATCH', body: { notifyStatusMail: 'nein' } })).status).toBe(422)
      expect((await a.request('/api/me/settings', { method: 'PATCH', body: { role: 'admin' } })).status).toBe(422)
      expect((await api(srv.url).request('/api/me/settings')).status).toBe(401)
      const off = await a.request('/api/me/settings', { method: 'PATCH', body: { notifyStatusMail: false } })
      expect(off.json).toEqual({ notifyStatusMail: false })
      expect((await b.request('/api/me/settings')).json).toEqual({ notifyStatusMail: true })
      expect((await a.request('/api/me/settings', { method: 'PATCH', body: { notifyStatusMail: true } })).json).toEqual({ notifyStatusMail: true })
    })

    it('Opt-out: kein Statusmail an Anna, solange sie widersprochen hat', async () => {
      await a.request('/api/me/settings', { method: 'PATCH', body: { notifyStatusMail: false } })
      fake.requireHeader('authorization', 'Bearer falsch')
      expect((await test(a, upA.id)).ok).toBe(false)
      expect((await a.request(`/api/upstreams/${upA.id}`)).json.status).toBe('auth_expired')
      await sleep(600)
      expect(statusMailsTo(smtp, 'anna@example.com')).toHaveLength(0)
      // zurueck auf gesund und wieder an, fuer die folgenden Tests
      fake.requireHeader('authorization', `Bearer ${SECRET}`)
      expect((await test(a, upA.id)).ok).toBe(true)
      await a.request('/api/me/settings', { method: 'PATCH', body: { notifyStatusMail: true } })
      await sleep(300)
      expect(statusMailsTo(smtp, 'anna@example.com')).toHaveLength(0)
    })

    it('echter Wechsel nach auth_expired: genau eine Mail an den Besitzer, mit Namen, Zustand und Link; escaped; ohne Secret', async () => {
      fake.requireHeader('authorization', 'Bearer falsch')
      expect((await test(a, upA.id)).ok).toBe(false)
      expect((await a.request(`/api/upstreams/${upA.id}`)).json.status).toBe('auth_expired')
      const m = await until(() => statusMailsTo(smtp, 'anna@example.com')[0])
      const raw = readable(m)
      expect(raw).toMatch(/^Subject: mcpwarden: .* Anmeldung abgelehnt/m)
      expect(raw).toContain(`${srv.url}/upstreams/${upA.id}`)
      expect(raw).toContain('&lt;b&gt;Wiki')
      expect(raw.split('text/html')[1]).not.toContain('<b>Wiki')
      expect(raw).not.toContain(SECRET)
      expect(raw).not.toContain('falsch')
      expect(m.to).toEqual(['anna@example.com'])
    })

    it('Flapping: erneuter Wechsel in das Fenster erzeugt keine zweite Mail; die Erholung genau eine', async () => {
      fake.requireHeader('authorization', `Bearer ${SECRET}`)
      expect((await test(a, upA.id)).ok).toBe(true)
      const rec = await until(() => statusMailsTo(smtp, 'anna@example.com')[1])
      expect(readable(rec)).toMatch(/^Subject: mcpwarden: .* wieder erreichbar/m)
      for (let i = 0; i < 3; i++) {
        fake.requireHeader('authorization', 'Bearer falsch')
        await test(a, upA.id)
        fake.requireHeader('authorization', `Bearer ${SECRET}`)
        await test(a, upA.id)
      }
      await sleep(800)
      expect(statusMailsTo(smtp, 'anna@example.com')).toHaveLength(2)
    })

    it('Mandanten: Bert bekommt nur Mails zu seinen Upstreams, Anna und der Admin nie zu fremden', async () => {
      fakeB.requireHeader('authorization', 'Bearer falsch')
      expect((await test(b, upB.id)).ok).toBe(false)
      const m = await until(() => statusMailsTo(smtp, 'bert@example.com')[0])
      const raw = readable(m)
      expect(raw).toContain('Berts Tickets')
      expect(raw).toContain(`${srv.url}/upstreams/${upB.id}`)
      await sleep(500)
      for (const x of statusMailsTo(smtp, 'anna@example.com')) expect(readable(x)).not.toContain('Berts Tickets')
      expect(statusMailsTo(smtp, 'admin@example.com')).toHaveLength(0)
      for (const x of statusMailsTo(smtp, 'bert@example.com')) {
        expect(readable(x)).not.toContain('Wiki')
        expect(readable(x)).not.toContain(upA.id)
      }
      // Anna kann Berts Einstellung nicht beeinflussen, und der Wechsel von Anna ist nicht in Berts Postfach
      expect(smtp.mails.every(x => x.to.length === 1)).toBe(true)
    })

    it('die Aufrufe selbst bleiben unbeeintraechtigt, wenn der SMTP-Server weg ist', async () => {
      await smtp.close()
      fakeB.requireHeader('authorization', `Bearer ${SECRET}`)
      const t0 = Date.now()
      expect((await test(b, upB.id)).ok).toBe(true)
      expect(Date.now() - t0).toBeLessThan(5000)
      expect((await b.request(`/api/upstreams/${upB.id}`)).json.status).toBe('healthy')
      expect(srv.logs()).not.toContain('bert@example.com')
      expect(srv.logs()).not.toContain(SECRET)
    })
  })
})

describe('ohne SMTP_URL', () => {
  let inst: TestInstance
  let srv: TestServer
  let admin: ApiClient

  beforeAll(async () => {
    inst = await createInstance()
    srv = await startServer(inst)
    admin = await signUpFirstAdmin(srv)
  })
  afterAll(async () => {
    await srv?.stop()
    await inst?.cleanup()
  })

  it('sendMail ist 422 (nicht eingerichtet), die Einladung ohne Versand funktioniert unveraendert', async () => {
    const r = await admin.request('/api/admin/invites', { body: { email: 'x@example.com', sendMail: true } })
    expect(r.status).toBe(422)
    expect(r.json.data.field).toBe('sendMail')
    const ok = await admin.request('/api/admin/invites', { body: { email: 'x@example.com' } })
    expect(ok.status).toBe(201)
    expect((ok.json as InviteCreated).mailQueued).toBe(false)
  })
  it('die Einstellung ist les- und schreibbar (ohne Wirkung)', async () => {
    expect((await admin.request('/api/me/settings')).json).toEqual({ notifyStatusMail: true })
    expect((await admin.request('/api/me/settings', { method: 'PATCH', body: { notifyStatusMail: false } })).json).toEqual({ notifyStatusMail: false })
  })
})
