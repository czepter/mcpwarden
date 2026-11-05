import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthSessionUser } from '../../shared/api-types'
import { INVITE_REQUIRED } from '../../shared/api-types'
import { ADMIN, api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
})
afterAll(async () => {
  await srv?.stop()
  await inst?.cleanup()
})

describe('Auth (A1, A7, A9)', () => {
  it('Passwort mit 11 Zeichen wird abgelehnt (400), kein Nutzer entsteht', async () => {
    const r = await api(srv.url).request('/api/auth/sign-up/email', { body: { name: 'x', email: 'x@example.com', password: '12345678901' } })
    expect(r.status).toBe(400)
  })

  it('erster Nutzer wird Admin, Session liefert role und banned', async () => {
    admin = await signUpFirstAdmin(srv)
    const s = await admin.request('/api/auth/get-session')
    expect(s.status).toBe(200)
    const user = s.json.user as AuthSessionUser
    expect(user).toMatchObject({ email: ADMIN.email, role: 'admin', banned: false })
  })

  it('weitere Registrierung ohne Einladung: 403 INVITE_REQUIRED', async () => {
    const r = await api(srv.url).request('/api/auth/sign-up/email', { body: { name: 'Z', email: 'z@example.com', password: 'z-passwort-1234' } })
    expect(r.status).toBe(403)
    expect(r.json).toMatchObject({ code: INVITE_REQUIRED })
  })

  it('Login: richtig 200, falsches Passwort 401', async () => {
    const ok = await api(srv.url).request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    expect(ok.status).toBe(200)
    const bad = await api(srv.url).request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: 'falsch-falsch-123' } })
    expect(bad.status).toBe(401)
    expect(bad.json).toHaveProperty('message')
  })

  it('Nutzer B ueber Admin-API: Rolle user, kein Zugriff auf Admin-Endpunkte', async () => {
    const b = await createUser(admin, { name: 'B', email: 'b@example.com', password: 'b-passwort-1234' })
    expect(b.role).toBe('user')
    const cb = api(srv.url, '203.0.113.8')
    expect((await cb.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'b-passwort-1234' } })).status).toBe(200)
    expect((await cb.request('/api/auth/get-session')).json.user.role).toBe('user')
    expect((await cb.request('/api/auth/admin/list-users?limit=10')).status).toBe(403)
    expect((await admin.request('/api/auth/admin/list-users?limit=10')).json.users).toHaveLength(2)
  })

  it('Admin-Sperre: gesperrter Nutzer kann sich nicht anmelden', async () => {
    const u = await createUser(admin, { name: 'C', email: 'c@example.com', password: 'c-passwort-1234' })
    expect((await admin.request('/api/auth/admin/ban-user', { body: { userId: u.id } })).status).toBe(200)
    const r = await api(srv.url, '203.0.113.9').request('/api/auth/sign-in/email', { body: { email: 'c@example.com', password: 'c-passwort-1234' } })
    expect(r.status).toBe(403)
  })

  it('20 parallele get-session-Aufrufe ohne Fehler (A7)', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => admin.request('/api/auth/get-session')))
    expect(rs.every(r => r.status === 200 && r.json?.user?.email === ADMIN.email)).toBe(true)
  })

  it('Selbstverwaltung fuer /settings: update-user, change-password, list-sessions, revoke-session', async () => {
    const c = api(srv.url, '203.0.113.20')
    await c.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    expect((await c.request('/api/auth/update-user', { body: { name: 'Admin 2' } })).status).toBe(200)
    const ls = await c.request('/api/auth/list-sessions')
    expect(ls.status).toBe(200)
    expect(Array.isArray(ls.json)).toBe(true)
    const other = ls.json.find((s: { token: string }) => s.token !== decodeURIComponent(c.jar.get('better-auth.session_token')!.split('.')[0]!))
    if (other) expect((await c.request('/api/auth/revoke-session', { body: { token: other.token } })).status).toBe(200)
    expect((await c.request('/api/auth/change-password', { body: { currentPassword: ADMIN.password, newPassword: 'neues-passwort-123' } })).status).toBe(200)
    expect((await api(srv.url, '203.0.113.21').request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: 'neues-passwort-123' } })).status).toBe(200)
    expect((await c.request('/api/auth/sign-out', { body: {} })).status).toBe(200)
    expect((await c.request('/api/auth/get-session')).json).toBeNull()
  })
})
