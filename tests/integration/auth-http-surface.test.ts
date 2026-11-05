// Review H-A / M-A: Better Auth endpoints that bypass mcpwarden checks (last admin, self-target, lifecycle, audit, DCR policy)
// are not reachable via HTTP, not even for an admin session.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdminUserList, OAuthClientAdminList } from '#shared/api-types'
import { ADMIN, api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient
let userB: ApiClient
let userBId: string
const B_PW = 'password-b-12345'

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  admin = await signUpFirstAdmin(srv)
  userBId = (await createUser(admin, { name: 'B', email: 'b@example.com', password: B_PW })).id
  userB = api(srv.url)
  expect((await userB.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: B_PW } })).status).toBe(200)
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

const ADMIN_ENDPOINTS: Array<[method: 'GET' | 'POST', path: string, body?: unknown]> = [
  ['POST', '/api/auth/admin/impersonate-user', { userId: '$B' }],
  ['POST', '/api/auth/admin/stop-impersonating', {}],
  ['POST', '/api/auth/admin/set-user-password', { userId: '$B', newPassword: 'attacker-password-1' }],
  ['POST', '/api/auth/admin/set-role', { userId: '$B', role: 'admin' }],
  ['POST', '/api/auth/admin/update-user', { userId: '$B', data: { role: 'admin', name: 'x' } }],
  ['POST', '/api/auth/admin/remove-user', { userId: '$B' }],
  ['POST', '/api/auth/admin/ban-user', { userId: '$B' }],
  ['POST', '/api/auth/admin/unban-user', { userId: '$B' }],
  ['POST', '/api/auth/admin/create-user', { name: 'E', email: 'evil@example.com', password: 'attacker-password-1', role: 'admin' }],
  ['GET', '/api/auth/admin/list-users?limit=10'],
  ['GET', '/api/auth/admin/get-user?id=$B'],
  ['POST', '/api/auth/admin/list-user-sessions', { userId: '$B' }],
  ['POST', '/api/auth/admin/revoke-user-session', { sessionToken: 'x' }],
  ['POST', '/api/auth/admin/revoke-user-sessions', { userId: '$B' }],
  ['POST', '/api/auth/admin/has-permission', { permissions: { user: ['list'] } }],
  ['POST', '/api/auth/admin/oauth2/create-client', { redirect_uris: ['https://evil.example/cb'], client_name: 'Evil' }],
  ['POST', '/api/auth/admin/oauth2/update-client', { client_id: 'x', update: { disabled: false } }],
  // Spellings that the router could also map to the admin endpoint
  ['POST', '/api/auth/admin/ban-user/', { userId: '$B' }],
  ['POST', '/api/auth/admin//ban-user', { userId: '$B' }],
  ['POST', '/api/auth/ADMIN/ban-user', { userId: '$B' }],
]

describe('all /api/auth/admin/* endpoints are refused over HTTP, even for an admin session', () => {
  for (const [method, path, body] of ADMIN_ENDPOINTS) {
    it(`${method} ${path}`, async () => {
      const p = path.replace('$B', userBId)
      const b = body ? JSON.parse(JSON.stringify(body).replace('$B', userBId)) : undefined
      const r = await admin.request(p, { method, body: b })
      expect([404, 403], r.text).toContain(r.status)
      // No identity of another user comes out of the admin session
      expect(r.text).not.toContain('b@example.com')
    })
  }

  it('leaves user B untouched: role, ban state, password and sessions', async () => {
    const list = (await admin.request('/api/admin/users')).json as AdminUserList
    const b = list.items.find(u => u.id === userBId)!
    expect(b).toMatchObject({ role: 'user', banned: false, name: 'B' })
    expect(list.items.some(u => u.email === 'evil@example.com')).toBe(false)
    const fresh = api(srv.url)
    expect((await fresh.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: B_PW } })).status).toBe(200)
    expect((await api(srv.url).request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'attacker-password-1' } })).status).toBe(401)
    expect((await userB.request('/api/auth/get-session')).json.user.id).toBe(userBId)
  })

  it('impersonation does not yield a session as another user', async () => {
    const res = await fetch(`${srv.url}/api/auth/admin/impersonate-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': srv.url, 'cookie': [...admin.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: JSON.stringify({ userId: userBId }),
    })
    expect(res.status).toBe(404)
    expect(res.headers.getSetCookie().join(';')).not.toMatch(/session_token=[^;]+/)
  })

  it('the real mcpwarden admin route still bans (server-side call), with last-admin and self protection', async () => {
    const self = await admin.request(`/api/admin/users/${(await admin.request('/api/auth/get-session')).json.user.id}/ban`, { body: {} })
    expect(self.status).toBe(409)
    expect(self.json.data.code).toBe('self_target')
    expect((await admin.request(`/api/admin/users/${userBId}/ban`, { body: {} })).status).toBe(204)
    expect((await admin.request(`/api/admin/users/${userBId}/unban`, { body: {} })).status).toBe(204)
  })
})

describe('OAuth client management over HTTP bypasses the DCR policy (M-A)', () => {
  it('a logged-in user cannot create or update clients via /oauth2/create-client and /oauth2/update-client', async () => {
    expect((await admin.request('/api/admin/oauth/policy', { method: 'PUT', body: { mode: 'off' } })).status).toBe(200)
    const before = ((await admin.request('/api/admin/oauth/clients')).json as OAuthClientAdminList).items.length
    const create = await userB.request('/api/auth/oauth2/create-client', {
      body: { redirect_uris: ['https://evil.example/callback'], client_name: 'Evil Client', token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] },
    })
    expect([403, 404], create.text).toContain(create.status)
    const asAdmin = await admin.request('/api/auth/oauth2/create-client', {
      body: { redirect_uris: ['https://evil.example/callback'], client_name: 'Evil Client', token_endpoint_auth_method: 'none' },
    })
    expect([403, 404], asAdmin.text).toContain(asAdmin.status)
    for (const p of ['/api/auth/oauth2/update-client', '/api/auth/oauth2/delete-client', '/api/auth/oauth2/client/rotate-secret', '/api/auth/oauth2/update-consent', '/api/auth/oauth2/delete-consent']) {
      const r = await userB.request(p, { body: { client_id: 'nope', id: 'nope', update: { disabled: false } } })
      expect([403, 404], `${p} ${r.text}`).toContain(r.status)
    }
    const after = ((await admin.request('/api/admin/oauth/clients')).json as OAuthClientAdminList).items.length
    expect(after).toBe(before)
    expect((await admin.request('/api/admin/oauth/policy', { method: 'PUT', body: { mode: 'open' } })).status).toBe(200)
  })
})

describe('regression: normal self-service auth routes keep working', () => {
  it('sign-in, get-session, update-user (name only), list-sessions', async () => {
    const c = api(srv.url)
    expect((await c.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })).status).toBe(200)
    expect((await c.request('/api/auth/get-session')).status).toBe(200)
    expect((await c.request('/api/auth/update-user', { body: { name: 'Admin New', role: 'user' } })).status).toBeLessThan(500)
    expect((await c.request('/api/auth/get-session')).json.user.role).toBe('admin')
    expect((await c.request('/api/auth/list-sessions')).status).toBe(200)
  })
})
