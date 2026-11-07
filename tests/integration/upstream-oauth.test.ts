// OAuth against an upstream MCP server: connect flow (discovery, dynamic registration, PKCE), refresh on 401, reconnect and
// the protections around the callback (single-use state, bound to the user who started the flow).
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { UpstreamDetail, UpstreamOAuthStart, UpstreamTestResult } from '#shared/api-types'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import type { FakeOAuth } from '../fixtures/fake-upstream/oauth'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let fake: FakeHttp
let oauth: FakeOAuth
let admin: ApiClient

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  fake = await startFakeHttp()
  oauth = fake.enableOAuth()
  admin = await signUpFirstAdmin(srv)
  expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })).status).toBe(200)
})
afterAll(async () => {
  await srv.stop()
  await fake.close()
  await inst.cleanup()
})

const test = async (c: ApiClient, id: string) => (await c.request(`/api/upstreams/${id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult
const detail = async (c: ApiClient, id: string) => (await c.request(`/api/upstreams/${id}`)).json as UpstreamDetail
const create = async (c: ApiClient, slug: string) =>
  (await c.request('/api/upstreams', { body: { name: slug, slug, type: 'http', url: fake.url, authType: 'oauth' } })).json as UpstreamDetail

/** Starts the flow, lets the fake authorization server answer, and returns the callback location the browser would visit. */
async function authorize(c: ApiClient, id: string) {
  const start = await c.request(`/api/upstreams/${id}/oauth/start`, { method: 'POST', body: {} })
  expect(start.status).toBe(200)
  const { authorizationUrl } = start.json as UpstreamOAuthStart
  expect(authorizationUrl).toMatch(/\/authorize\?/)
  const back = await fetch(authorizationUrl!, { redirect: 'manual' })
  expect(back.status).toBe(302)
  return new URL(back.headers.get('location')!)
}
/** The browser follows the redirect to mcpwarden (with the session cookie) and gets bounced back into the UI. */
async function callback(c: ApiClient, loc: URL) {
  const res = await fetch(c.baseUrl + loc.pathname + loc.search, { redirect: 'manual', headers: { cookie: [...c.jar].map(([k, v]) => `${k}=${v}`).join('; ') } })
  return { status: res.status, location: res.headers.get('location') ?? '' }
}

it('connects through the browser flow, calls with the token, refreshes on 401 and keeps tokens out of the API', async () => {
  const up = await create(admin, 'oa')
  expect(up).toMatchObject({ authType: 'oauth', setup: 'awaiting_auth', hasSecret: false })
  expect(await test(admin, up.id)).toMatchObject({ ok: false, errorCode: 'awaiting_auth' })

  const loc = await authorize(admin, up.id)
  expect(oauth.stats.registrations).toBe(1)
  expect(oauth.stats.redirectUris).toEqual([`${srv.url}/api/upstream-oauth/callback`])
  const cb = await callback(admin, loc)
  expect(cb).toMatchObject({ status: 302, location: `/upstreams/${up.id}?tab=auth&oauth=ok` })

  const connected = await detail(admin, up.id)
  expect(connected).toMatchObject({ setup: 'ready', hasSecret: true, secretNames: ['oauth'] })
  expect(JSON.stringify(connected)).not.toMatch(/at-|rt-|client-1/)
  const t = await test(admin, up.id)
  expect(t.ok).toBe(true)
  expect(oauth.stats.tokenGrants).toEqual(['authorization_code'])

  // The access token expires: the SDK refreshes (rotating the refresh token) and the call goes through again
  oauth.expireAccess()
  expect((await test(admin, up.id)).ok).toBe(true)
  expect(oauth.stats.tokenGrants).toEqual(['authorization_code', 'refresh_token'])
  oauth.expireAccess()
  expect((await test(admin, up.id)).ok).toBe(true) // the rotated refresh token was stored
  expect(oauth.stats.tokenGrants.filter(g => g === 'refresh_token')).toHaveLength(2)
})

it('a revoked refresh token turns the upstream into auth_expired; reconnecting repairs it', async () => {
  const up = await create(admin, 'oa-expire')
  await callback(admin, await authorize(admin, up.id))
  expect((await test(admin, up.id)).ok).toBe(true)

  oauth.expireAccess()
  oauth.revokeRefresh()
  const failed = await test(admin, up.id)
  expect(failed).toMatchObject({ ok: false, errorCode: 'unauthorized' })
  expect((await detail(admin, up.id)).status).toBe('auth_expired')

  await callback(admin, await authorize(admin, up.id))
  expect((await test(admin, up.id)).ok).toBe(true)
})

it('the callback state is single use, bound to the user and answers with a redirect only', async () => {
  const up = await create(admin, 'oa-state')
  const loc = await authorize(admin, up.id)

  // another signed-in user cannot redeem the flow of the admin
  const other = api(srv.url, '198.51.100.9')
  const u2 = { name: 'Other', email: 'other@example.com', password: 'other-password-123' }
  await createUser(admin, u2)
  expect((await other.request('/api/auth/sign-in/email', { body: { email: u2.email, password: u2.password } })).status).toBe(200)
  expect(await callback(other, loc)).toMatchObject({ status: 302, location: '/upstreams?oauth=error' })
  // ... and the state is gone for the owner as well (single use)
  expect(await callback(admin, loc)).toMatchObject({ status: 302, location: '/upstreams?oauth=error' })
  expect((await detail(admin, up.id)).hasSecret).toBe(false)

  // a bogus or missing state never reaches the upstream
  const grants = oauth.stats.tokenGrants.length
  expect(await callback(admin, new URL(`${srv.url}/api/upstream-oauth/callback?code=x&state=nope`))).toMatchObject({ location: '/upstreams?oauth=error' })
  expect(await callback(admin, new URL(`${srv.url}/api/upstream-oauth/callback?code=x`))).toMatchObject({ location: '/upstreams?oauth=error' })
  expect(oauth.stats.tokenGrants.length).toBe(grants)

  // a denied consent is reported without an error text
  const loc2 = await authorize(admin, up.id)
  const denied = new URL(loc.pathname + `?error=access_denied&state=${loc2.searchParams.get('state')}`, srv.url)
  expect(await callback(admin, denied)).toMatchObject({ location: `/upstreams/${up.id}?tab=auth&oauth=denied` })
})

it('disconnect and changing the server URL or auth kind discard the session', async () => {
  const up = await create(admin, 'oa-drop')
  await callback(admin, await authorize(admin, up.id))
  expect((await detail(admin, up.id)).hasSecret).toBe(true)

  expect((await admin.request(`/api/upstreams/${up.id}/oauth`, { method: 'DELETE' })).status).toBe(204)
  expect(await detail(admin, up.id)).toMatchObject({ setup: 'awaiting_auth', hasSecret: false })
  expect(await test(admin, up.id)).toMatchObject({ ok: false, errorCode: 'awaiting_auth' })

  await callback(admin, await authorize(admin, up.id))
  const moved = await admin.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { url: `${fake.url}?moved=1` } })
  expect(moved.json as UpstreamDetail).toMatchObject({ setup: 'awaiting_auth', hasSecret: false })
  await admin.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { url: fake.url } })

  await callback(admin, await authorize(admin, up.id))
  const none = await admin.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { authType: 'none' } })
  expect(none.json as UpstreamDetail).toMatchObject({ setup: 'ready', hasSecret: false })
})

it('rejects secrets for oauth upstreams and the flow for other auth kinds', async () => {
  const up = await create(admin, 'oa-secret')
  expect((await admin.request(`/api/upstreams/${up.id}/secret`, { method: 'PUT', body: { kind: 'bearer', value: 'x' } })).status).toBe(422)
  const plain = (await admin.request('/api/upstreams', { body: { name: 'P', slug: 'oa-plain', type: 'http', url: fake.url, authType: 'none' } })).json as UpstreamDetail
  expect((await admin.request(`/api/upstreams/${plain.id}/oauth/start`, { method: 'POST', body: {} })).status).toBe(422)
})

it('probe tells before saving whether the URL offers OAuth with registration', async () => {
  const probe = async (url: string) => admin.request('/api/upstreams/probe', { body: { url } })
  expect((await probe(fake.url)).json).toEqual({ oauth: 'dcr' })
  const plain = await startFakeHttp()
  try { expect((await probe(plain.url)).json).toEqual({ oauth: 'none' }) } finally { await plain.close() }
  expect((await probe('http://169.254.169.254/mcp')).status).toBe(422)
  expect((await probe('not a url')).status).toBe(422)
  expect((await api(srv.url).request('/api/upstreams/probe', { body: { url: fake.url } })).status).toBe(401)
})
