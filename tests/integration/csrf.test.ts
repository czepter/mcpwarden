// Review M-G: Cookie-authentifizierte, verändernde /api/**-Routen lehnen fremde Ursprünge ab.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdminUserList, PatCreated, UpstreamList } from '#shared/api-types'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient
let bId: string
const cookie = () => [...admin.jar].map(([k, v]) => `${k}=${v}`).join('; ')

/** Eine "Seite eines Angreifers": Browser sendet die Cookies mit, Origin ist die fremde Seite. */
const cross = (path: string, init: { method?: string, body?: string, type?: string, origin?: string, site?: string } = {}) => fetch(srv.url + path, {
  method: init.method ?? 'POST',
  headers: {
    cookie: cookie(),
    ...(init.origin === undefined ? { origin: 'https://evil.example' } : init.origin ? { origin: init.origin } : {}),
    ...(init.site ? { 'sec-fetch-site': init.site } : {}),
    ...(init.type ? { 'content-type': init.type } : {}),
  },
  body: init.body,
})

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  admin = await signUpFirstAdmin(srv)
  bId = (await createUser(admin, { name: 'B', email: 'b@example.com', password: 'passwort-b-12345' })).id
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

describe('cross-origin mutations with the admin cookie', () => {
  it('urlencoded form POST (no preflight) cannot create an upstream', async () => {
    const r = await cross('/api/upstreams', { type: 'application/x-www-form-urlencoded', body: 'name=Evil&slug=evil&type=http&url=https%3A%2F%2Fexample.com%2Fmcp' })
    expect(r.status).toBe(403)
    expect(((await admin.request('/api/upstreams')).json as UpstreamList).items).toHaveLength(0)
  })
  it('text/plain JSON body is refused as well', async () => {
    const r = await cross('/api/upstreams', { type: 'text/plain', body: JSON.stringify({ name: 'Evil', slug: 'evil', type: 'http', url: 'https://example.com/mcp' }) })
    expect(r.status).toBe(403)
  })
  it('body-less POST (fetch no-cors) cannot ban a user or create a PAT', async () => {
    expect((await cross(`/api/admin/users/${bId}/ban`)).status).toBe(403)
    expect((await cross('/api/me/pats', { type: 'application/x-www-form-urlencoded', body: 'name=evil' })).status).toBe(403)
    const list = (await admin.request('/api/admin/users')).json as AdminUserList
    expect(list.items.find(u => u.id === bId)?.banned).toBe(false)
  })
  it('DELETE, PUT and PATCH from a foreign origin are refused', async () => {
    expect((await cross(`/api/admin/users/${bId}`, { method: 'DELETE' })).status).toBe(403)
    expect((await cross('/api/admin/settings', { method: 'PUT', type: 'application/json', body: '{}' })).status).toBe(403)
    expect((await cross('/api/me/settings', { method: 'PATCH', type: 'application/json', body: '{"notifyStatusMail":false}' })).status).toBe(403)
  })
  it('the opaque "null" origin and a missing Origin with Sec-Fetch-Site: cross-site are refused', async () => {
    expect((await cross('/api/me/pats', { origin: 'null', type: 'application/json', body: '{"name":"x"}' })).status).toBe(403)
    expect((await cross('/api/me/pats', { origin: '', site: 'cross-site', type: 'application/json', body: '{"name":"x"}' })).status).toBe(403)
  })
  it('a refusal carries the standard error shape', async () => {
    const r = await cross('/api/me/pats', { type: 'application/json', body: '{"name":"x"}' })
    expect(await r.json()).toMatchObject({ statusCode: 403, data: { code: 'forbidden_origin' } })
  })
})

describe('legitimate requests still work', () => {
  it('same origin (BASE_URL) with the cookie', async () => {
    const r = await cross('/api/me/pats', { origin: srv.url, type: 'application/json', body: '{"name":"ok"}' })
    expect(r.status).toBe(201)
  })
  it('no Origin and no Sec-Fetch-Site (non-browser client)', async () => {
    expect((await cross('/api/me/pats', { origin: '', type: 'application/json', body: '{"name":"cli"}' })).status).toBe(201)
  })
  it('a PAT/Bearer request is exempt from the origin check', async () => {
    const pat = (await admin.request('/api/me/pats', { body: { name: 'bearer' } })).json as PatCreated
    const r = await fetch(`${srv.url}/api/me/pats`, { method: 'POST', headers: { 'authorization': `Bearer ${pat.token}`, 'origin': 'https://evil.example', 'content-type': 'application/json' }, body: '{"name":"x"}' })
    // /api/me/pats nimmt nur Sitzungen an (401), entscheidend ist: nicht die 403 der Origin-Pruefung
    expect(r.status).not.toBe(403)
  })
  it('GET from a foreign origin is not blocked by this check (read-only)', async () => {
    const r = await cross('/api/me/pats', { method: 'GET' })
    expect(r.status).toBe(200)
  })
  it('Better Auth routes keep their own check (sign-in from the app origin works)', async () => {
    const c = api(srv.url)
    expect((await c.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'passwort-b-12345' } })).status).toBe(200)
  })
})
