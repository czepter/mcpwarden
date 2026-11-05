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
  it('password with 11 characters is rejected (400), no user is created', async () => {
    const r = await api(srv.url).request('/api/auth/sign-up/email', { body: { name: 'x', email: 'x@example.com', password: '12345678901' } })
    expect(r.status).toBe(400)
  })

  it('first user becomes admin, session returns role and banned', async () => {
    admin = await signUpFirstAdmin(srv)
    const s = await admin.request('/api/auth/get-session')
    expect(s.status).toBe(200)
    const user = s.json.user as AuthSessionUser
    expect(user).toMatchObject({ email: ADMIN.email, role: 'admin', banned: false })
  })

  it('further registration without an invitation: 403 INVITE_REQUIRED', async () => {
    const r = await api(srv.url).request('/api/auth/sign-up/email', { body: { name: 'Z', email: 'z@example.com', password: 'z-password-1234' } })
    expect(r.status).toBe(403)
    expect(r.json).toMatchObject({ code: INVITE_REQUIRED })
  })

  it('Login: correct 200, wrong password 401', async () => {
    const ok = await api(srv.url).request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    expect(ok.status).toBe(200)
    const bad = await api(srv.url).request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: 'wrong-wrong-123' } })
    expect(bad.status).toBe(401)
    expect(bad.json).toHaveProperty('message')
  })

  it('User B via invitation: role user, no access to admin endpoints', async () => {
    const b = await createUser(admin, { name: 'B', email: 'b@example.com', password: 'b-password-1234' })
    expect(b.role).toBe('user')
    const cb = api(srv.url, '203.0.113.8')
    expect((await cb.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'b-password-1234' } })).status).toBe(200)
    expect((await cb.request('/api/auth/get-session')).json.user.role).toBe('user')
    expect((await cb.request('/api/admin/users')).status).toBe(403)
    expect((await admin.request('/api/admin/users')).json.items).toHaveLength(2)
  })

  it('Admin ban: banned user cannot sign in', async () => {
    const u = await createUser(admin, { name: 'C', email: 'c@example.com', password: 'c-password-1234' })
    expect((await admin.request(`/api/admin/users/${u.id}/ban`, { body: {} })).status).toBe(204)
    const r = await api(srv.url, '203.0.113.9').request('/api/auth/sign-in/email', { body: { email: 'c@example.com', password: 'c-password-1234' } })
    expect(r.status).toBe(403)
  })

  it('20 parallel get-session calls without errors (A7)', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => admin.request('/api/auth/get-session')))
    expect(rs.every(r => r.status === 200 && r.json?.user?.email === ADMIN.email)).toBe(true)
  })

  it('Self-service for /settings: update-user, change-password, list-sessions, revoke-session', async () => {
    const c = api(srv.url, '203.0.113.20')
    await c.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    expect((await c.request('/api/auth/update-user', { body: { name: 'Admin 2' } })).status).toBe(200)
    const ls = await c.request('/api/auth/list-sessions')
    expect(ls.status).toBe(200)
    expect(Array.isArray(ls.json)).toBe(true)
    const other = ls.json.find((s: { token: string }) => s.token !== decodeURIComponent(c.jar.get('better-auth.session_token')!.split('.')[0]!))
    if (other) expect((await c.request('/api/auth/revoke-session', { body: { token: other.token } })).status).toBe(200)
    expect((await c.request('/api/auth/change-password', { body: { currentPassword: ADMIN.password, newPassword: 'neues-password-123' } })).status).toBe(200)
    expect((await api(srv.url, '203.0.113.21').request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: 'neues-password-123' } })).status).toBe(200)
    expect((await c.request('/api/auth/sign-out', { body: {} })).status).toBe(200)
    expect((await c.request('/api/auth/get-session')).json).toBeNull()
  })
})
