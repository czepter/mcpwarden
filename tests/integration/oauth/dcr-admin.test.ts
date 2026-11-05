// Task 3: DCR policy (three modes), allowlist, client management and access protection of the admin routes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AllowlistEntry, AllowlistList, DcrPolicy, OAuthClientAdmin, OAuthClientAdminList } from '#shared/api-types'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from '../harness'
import { registerClient } from '../../helpers/oauth-client'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient
let userB: ApiClient
const anon = () => api(srv.url)

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  admin = await signUpFirstAdmin(srv)
  await createUser(admin, { name: 'B', email: 'b@example.com', password: 'password-b-12345' })
  userB = api(srv.url)
  const r = await userB.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'password-b-12345' } })
  expect(r.status).toBe(200)
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

const setMode = (mode: string) => admin.request('/api/admin/oauth/policy', { method: 'PUT', body: { mode } })

describe('admin routes: anonymous 401, non-admin 403, admin 2xx', () => {
  const routes: [string, string, unknown?][] = [
    ['GET', '/api/admin/oauth/policy'],
    ['PUT', '/api/admin/oauth/policy', { mode: 'open' }],
    ['GET', '/api/admin/oauth/allowlist'],
    ['POST', '/api/admin/oauth/allowlist', { label: 'X', namePattern: 'X*', redirectPatterns: ['http://localhost:*'] }],
    ['DELETE', '/api/admin/oauth/allowlist/00000000-0000-4000-8000-000000000000'],
    ['POST', '/api/admin/oauth/allowlist/reset-builtins', {}],
    ['GET', '/api/admin/oauth/clients'],
    ['PATCH', '/api/admin/oauth/clients/nope', { disabled: true }],
    ['DELETE', '/api/admin/oauth/clients/nope'],
  ]
  for (const [method, path, body] of routes) {
    it(`${method} ${path}`, async () => {
      expect((await anon().request(path, { method, body: body ?? undefined })).status).toBe(401)
      expect((await userB.request(path, { method, body: body ?? undefined })).status).toBe(403)
      const ok = await admin.request(path, { method, body: body ?? undefined })
      expect(ok.status, ok.text).toBeLessThan(500)
      expect([401, 403]).not.toContain(ok.status)
    })
  }
})

describe('policy and allowlist routes (contract shapes)', () => {
  it('default is open', async () => {
    const r = await admin.request('/api/admin/oauth/policy')
    expect(r.status).toBe(200)
    expect(r.json satisfies DcrPolicy).toEqual({ mode: 'open' })
    expect(r.text).not.toContain('secret')
  })
  it('PUT rejects invalid modes with data.code invalid_mode', async () => {
    const r = await setMode('maybe')
    expect(r.status).toBe(400)
    expect(r.json.data.code).toBe('invalid_mode')
    expect(r.json.statusMessage).toBe('Bad Request')
  })
  it('lists the seeded builtins', async () => {
    const r = await admin.request('/api/admin/oauth/allowlist')
    const body = r.json as AllowlistList
    expect(body.items.map(e => e.label)).toEqual(expect.arrayContaining(['Claude Code', 'Cursor', 'VS Code', 'Windsurf', 'Zed', 'Codex']))
    for (const e of body.items) {
      expect(Object.keys(e).sort()).toEqual(['builtin', 'createdAt', 'id', 'label', 'namePattern', 'redirectPatterns'])
      expect(Number.isNaN(Date.parse(e.createdAt))).toBe(false)
    }
  })
  it('adds, validates and removes entries; 404 for unknown ids', async () => {
    const bad = await admin.request('/api/admin/oauth/allowlist', { body: { label: 'X', namePattern: 'X', redirectPatterns: ['javascript://x'] } })
    expect(bad.status).toBe(400)
    expect(bad.json.data).toMatchObject({ code: 'invalid_entry', field: 'redirectPatterns' })
    const ok = await admin.request('/api/admin/oauth/allowlist', { body: { label: 'Mine', namePattern: 'Mine*', redirectPatterns: ['mine://'] } })
    expect(ok.status).toBe(201)
    const entry = ok.json as AllowlistEntry
    expect(entry).toMatchObject({ label: 'Mine', builtin: false })
    expect((await admin.request(`/api/admin/oauth/allowlist/${entry.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await admin.request(`/api/admin/oauth/allowlist/${entry.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await admin.request('/api/admin/oauth/allowlist/not-a-uuid', { method: 'DELETE' })).status).toBe(404)
  })
  it('reset-builtins restores deleted builtins', async () => {
    const list = (await admin.request('/api/admin/oauth/allowlist')).json as AllowlistList
    const zed = list.items.find(e => e.label === 'Zed')!
    expect((await admin.request(`/api/admin/oauth/allowlist/${zed.id}`, { method: 'DELETE' })).status).toBe(204)
    const r = await admin.request('/api/admin/oauth/allowlist/reset-builtins', { body: {} })
    expect(r.status).toBe(200)
    expect((r.json as AllowlistList).items.map(e => e.label)).toContain('Zed')
  })
})

describe('DCR policy modes against /api/auth/oauth2/register', () => {
  it('open (default): anything valid registers; allowlisted flag is tracked', async () => {
    expect((await setMode('open')).status).toBe(200)
    const known = await registerClient(srv.url, { client_name: 'Claude Code (known)' })
    const unknown = await registerClient(srv.url, { client_name: 'Totally Unknown', redirect_uris: ['http://127.0.0.1:4444/cb'] })
    expect(known.status).toBe(201)
    expect(unknown.status).toBe(201)
    const clients = ((await admin.request('/api/admin/oauth/clients')).json as OAuthClientAdminList).items
    const k = clients.find(c => c.id === known.json.client_id)!
    const u = clients.find(c => c.id === unknown.json.client_id)!
    expect(k).toMatchObject({ allowlisted: true, registeredVia: 'dcr', disabled: false, userCount: 0, lastUsedAt: null })
    expect(u).toMatchObject({ allowlisted: false, registeredVia: 'dcr' })
    expect(Date.parse(u.expiresAt!) - Date.parse(u.createdAt)).toBe(30 * 24 * 3600_000)
  })
  it('open still rejects dangerous redirects', async () => {
    for (const uri of ['javascript:alert(1)', 'http://evil.example/cb', 'data:text/html,x', 'http://localhost.evil.com/cb', 'https://user:pw@a.example/cb']) {
      const r = await registerClient(srv.url, { redirect_uris: [uri] })
      expect(r.status, uri).toBe(400)
      expect(r.json.error, uri).toMatch(/invalid_redirect_uri|invalid_client_metadata/)
    }
  })
  it('off: registration is denied (RFC 7591 error, 403)', async () => {
    await setMode('off')
    const r = await registerClient(srv.url)
    expect(r.status).toBe(403)
    expect(r.json).toMatchObject({ error: 'access_denied' })
  })
  it('allowlist: name AND redirect pattern must match', async () => {
    await setMode('allowlist')
    expect((await registerClient(srv.url, { client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:53124/callback'] })).status).toBe(201)
    expect((await registerClient(srv.url, { client_name: 'Claude Code', redirect_uris: ['http://localhost:8123/callback'] })).status).toBe(201)
    const evil = await registerClient(srv.url, { client_name: 'Claude Code', redirect_uris: ['http://evil.example/cb'] })
    expect(evil.status).toBe(400)
    const unknownName = await registerClient(srv.url, { client_name: 'Not Listed', redirect_uris: ['http://127.0.0.1:53124/callback'] })
    expect(unknownName.status).toBe(400)
    expect(unknownName.json.error).toBe('invalid_client_metadata')
    const mixed = await registerClient(srv.url, { client_name: 'Claude Code', redirect_uris: ['http://127.0.0.1:1/cb', 'cursor://evil'] })
    expect(mixed.status).toBe(400)
    await setMode('open')
  })
  it('no client_credentials clients through anonymous registration', async () => {
    const r = await registerClient(srv.url, { grant_types: ['client_credentials'], token_endpoint_auth_method: 'client_secret_basic' })
    expect(r.status).toBe(400)
  })
  it('PATCH disables, DELETE revokes a client', async () => {
    const reg = await registerClient(srv.url, { client_name: 'Claude Code (manage)' })
    const id = reg.json.client_id as string
    const p = await admin.request(`/api/admin/oauth/clients/${id}`, { method: 'PATCH', body: { disabled: true } })
    expect(p.status).toBe(200)
    expect((p.json satisfies OAuthClientAdmin).disabled).toBe(true)
    expect((await admin.request(`/api/admin/oauth/clients/${id}`, { method: 'PATCH', body: { disabled: 'yes' } })).json.data.code).toBe('invalid_body')
    expect((await admin.request(`/api/admin/oauth/clients/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await admin.request(`/api/admin/oauth/clients/${id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await admin.request('/api/admin/oauth/clients/unknown', { method: 'PATCH', body: { disabled: true } })).status).toBe(404)
  })
})

describe('DCR rate limit (own server with the limiter on)', () => {
  it('answers 429 after 5 registrations per minute and IP', async () => {
    const i2 = await createInstance()
    const s2 = await startServer(i2, { rateLimit: true })
    try {
      const ip = '203.0.113.50'
      const codes: number[] = []
      for (let n = 0; n < 7; n++) codes.push((await registerClient(s2.url, {}, ip)).status)
      expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201])
      expect(codes.slice(5)).toEqual([429, 429])
      expect((await registerClient(s2.url, {}, '203.0.113.51')).status).toBe(201) // different sender
    } finally {
      await s2.stop()
      await i2.cleanup()
    }
  })
})
