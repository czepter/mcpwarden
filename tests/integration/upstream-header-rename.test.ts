// Review L-e: Aendert sich authHeaderName, passt das gespeicherte Header-Secret nicht mehr (es ist an den Namen gebunden).
// Es wird entfernt und der Upstream wartet auf neue Zugangsdaten, statt still ohne Auth-Header zu verbinden.
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { UpstreamDetail, UpstreamTestResult } from '#shared/api-types'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { createInstance, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let fake: FakeHttp
let admin: ApiClient

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  fake = await startFakeHttp()
  admin = await signUpFirstAdmin(srv)
  expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })).status).toBe(200)
})
afterAll(async () => {
  await srv.stop()
  await fake.close()
  await inst.cleanup()
})

it('renaming the auth header drops the bound secret and forces awaiting_auth; a new secret works under the new name', async () => {
  fake.requireHeader('x-api-key', 's3cret')
  const created = (await admin.request('/api/upstreams', { body: { name: 'H', slug: 'hdr', type: 'http', url: fake.url, authType: 'header', authHeaderName: 'X-Api-Key' } })).json as UpstreamDetail
  expect(created.setup).toBe('awaiting_auth')
  expect((await admin.request(`/api/upstreams/${created.id}/secret`, { method: 'PUT', body: { kind: 'header', value: 's3cret' } })).status).toBe(200)
  expect(((await admin.request(`/api/upstreams/${created.id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult).ok).toBe(true)

  const renamed = await admin.request(`/api/upstreams/${created.id}`, { method: 'PATCH', body: { authHeaderName: 'X-Other' } })
  expect(renamed.status).toBe(200)
  expect(renamed.json as UpstreamDetail).toMatchObject({ authHeaderName: 'X-Other', setup: 'awaiting_auth', hasSecret: false, secretNames: [] })
  const t = (await admin.request(`/api/upstreams/${created.id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult
  expect(t).toMatchObject({ ok: false, errorCode: 'awaiting_auth' })

  fake.requireHeader('x-other', 's3cret')
  const before = fake.state.requests.length
  expect((await admin.request(`/api/upstreams/${created.id}/secret`, { method: 'PUT', body: { kind: 'header', value: 's3cret' } })).status).toBe(200)
  expect(((await admin.request(`/api/upstreams/${created.id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult).ok).toBe(true)
  expect(fake.state.requests.slice(before).some(r => r.headers['x-other'] === 's3cret')).toBe(true)
})

it('PATCH with the same header name keeps the secret (idempotent), changing only other fields keeps it too', async () => {
  fake.requireHeader('x-keep', 'k')
  const up = (await admin.request('/api/upstreams', { body: { name: 'K', slug: 'keep', type: 'http', url: fake.url, authType: 'header', authHeaderName: 'X-Keep' } })).json as UpstreamDetail
  await admin.request(`/api/upstreams/${up.id}/secret`, { method: 'PUT', body: { kind: 'header', value: 'k' } })
  const same = (await admin.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { authHeaderName: 'X-Keep', name: 'K2' } })).json as UpstreamDetail
  expect(same).toMatchObject({ setup: 'ready', hasSecret: true })
})
