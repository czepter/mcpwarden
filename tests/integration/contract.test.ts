// Vertrags-Test gegen ECHTE Backend-Antworten: das gebaute Artefakt (PGlite oder Postgres, je TEST_BACKEND) beantwortet jede
// Route, die das Frontend benutzt; jede Antwort muss das strikte zod-Schema aus tests/contract/schemas.ts bestehen. Dieselben
// Schemas pruefen die MSW-Mocks (tests/ui/contract). So koennen Mock und Backend nicht auseinanderlaufen.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { InviteCreated, UpstreamDetail } from '#shared/api-types'
import { schemas } from '../contract/schemas'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { fullFlow } from '../helpers/oauth-client'
import { api, createInstance, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let fake: FakeHttp
let admin: ApiClient
let user: ApiClient
const PW = 'passwort-1234567'

/** Antwort muss Status und Schema erfuellen; bei Abweichung zeigt der Fehler Route und zod-Issues. */
function expectContract<T extends z.ZodType>(label: string, r: { status: number, json: unknown, text: string }, schema: T, status = 200): z.infer<T> {
  expect(r.status, `${label}: ${r.text}`).toBe(status)
  const res = schema.safeParse(r.json)
  expect(res.success ? [] : res.error.issues, `${label}: ${r.text}`).toEqual([])
  return res.data as z.infer<T>
}

async function invitedUser(email: string): Promise<ApiClient> {
  const inv = expectContract('Einladung anlegen', await admin.request('/api/admin/invites', { body: { email } }), schemas.inviteCreated, 201) as InviteCreated
  const token = inv.link.split('/invite/')[1]!
  const su = await fetch(`${srv.url}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: srv.url, 'x-invite-token': token },
    body: JSON.stringify({ name: 'Nutzer', email, password: PW }),
  })
  expect(su.status).toBe(200)
  const c = api(srv.url, '198.51.100.20')
  expect((await c.request('/api/auth/sign-in/email', { body: { email, password: PW } })).status).toBe(200)
  return c
}

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  fake = await startFakeHttp()
  // vor dem ersten Nutzer: Registrierung offen (Login-/Registrierungsseite lesen das aus /api/public-config)
  const pub = expectContract('public-config (leer)', await api(srv.url).request('/api/public-config'), schemas.publicConfig)
  expect(pub.registrationOpen).toBe(true)
  admin = await signUpFirstAdmin(srv)
  expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })).status).toBe(200)
  user = await invitedUser('user@example.com')
})
afterAll(async () => {
  await srv.stop()
  await fake.close()
  await inst.cleanup()
})

describe('oeffentliche Routen', () => {
  it('public-config: registrationOpen ist nach dem ersten Nutzer false', async () => {
    const pub = expectContract('public-config', await api(srv.url).request('/api/public-config'), schemas.publicConfig)
    expect(pub).toEqual({ mail: false, registrationOpen: false })
  })
  it('Einladungs-Pruefung: gueltig und ungueltig', async () => {
    const inv = (await admin.request('/api/admin/invites', { body: {} })).json as InviteCreated
    const token = inv.link.split('/invite/')[1]!
    expect(expectContract('invite ok', await api(srv.url).request(`/api/invites/${token}`), schemas.inviteCheck)).toMatchObject({ valid: true })
    expect(expectContract('invite unknown', await api(srv.url).request(`/api/invites/${'z'.repeat(43)}`), schemas.inviteCheck)).toEqual({ valid: false, reason: 'unknown' })
  })
  it('Sitzung: ohne Anmeldung null, mit Anmeldung enthaelt die Teilmenge des Vertrags', async () => {
    const anon = await api(srv.url).request('/api/auth/get-session')
    expect(anon.status).toBe(200)
    expect(schemas.session.parse(anon.json)).toBeNull()
    // Better Auth liefert mehr Felder als der Vertrag (Teilmenge): hier nur die vertraglichen Felder pruefen
    const s = await admin.request('/api/auth/get-session')
    const subset = z.object({
      user: z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.enum(['admin', 'user']), banned: z.boolean().nullish() }),
      session: z.object({ id: z.string(), expiresAt: z.string() }),
    })
    expect(subset.safeParse(s.json).success, s.text).toBe(true)
    expect(s.json.user.role).toBe('admin')
  })
})

describe('Nutzerrouten', () => {
  let up: UpstreamDetail
  it('Capabilities', async () => {
    expect(expectContract('capabilities', await user.request('/api/me/capabilities'), schemas.capabilities)).toMatchObject({ role: 'user' })
  })
  it('Upstream anlegen, lesen, testen, Tools, Liste', async () => {
    up = expectContract('upstream anlegen', await user.request('/api/upstreams', { body: { name: 'Fake', slug: 'fake', type: 'http', url: fake.url, authType: 'none' } }), schemas.upstreamDetail, 201)
    expectContract('upstream detail', await user.request(`/api/upstreams/${up.id}`), schemas.upstreamDetail)
    const t = expectContract('upstream test', await user.request(`/api/upstreams/${up.id}/test`, { method: 'POST', body: {} }), schemas.testResult)
    expect(t.ok).toBe(true)
    expectContract('upstream tools', await user.request(`/api/upstreams/${up.id}/tools`), schemas.tools)
    const list = expectContract('upstream liste', await user.request('/api/upstreams'), schemas.upstreamList)
    expect(list.items.map(i => i.slug)).toEqual(['fake'])
    // PATCH liefert wieder die Detail-Form; Tool-Schalter die Tool-Form
    expectContract('upstream patch', await user.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { name: 'Fake 2' } }), schemas.upstreamDetail)
    expectContract('tool schalten', await user.request(`/api/upstreams/${up.id}/tools/echo`, { method: 'PUT', body: { enabled: true } }), schemas.tools.shape.items.element)
  })
  it('Secret setzen: Antwort-Form; Detail zeigt nur hasSecret', async () => {
    const b = await user.request('/api/upstreams', { body: { name: 'Mit Secret', slug: 'sec', type: 'http', url: fake.url, authType: 'bearer' } })
    const sec = expectContract('upstream (bearer)', b, schemas.upstreamDetail, 201)
    expect(sec.setup).toBe('awaiting_auth')
    const put = await user.request(`/api/upstreams/${sec.id}/secret`, { method: 'PUT', body: { kind: 'bearer', value: 'sk-contract-secret' } })
    expect(put.json).toEqual({ hasSecret: true, setup: 'ready' })
    const detail = expectContract('detail nach Secret', await user.request(`/api/upstreams/${sec.id}`), schemas.upstreamDetail)
    expect(detail.hasSecret).toBe(true)
    expect(JSON.stringify(detail)).not.toContain('sk-contract-secret')
    expect((await user.request(`/api/upstreams/${sec.id}`, { method: 'DELETE' })).status).toBe(204)
  })
  it('PATs: Anlegen (Klartext einmalig), Liste', async () => {
    const created = expectContract('pat anlegen', await user.request('/api/me/pats', { body: { name: 'contract' } }), schemas.patCreated, 201)
    const list = expectContract('pat liste', await user.request('/api/me/pats'), schemas.pats)
    expect(JSON.stringify(list)).not.toContain(created.token)
    expect(list.items.some(p => p.id === created.id)).toBe(true)
  })
  it('OAuth: Consent-Info, Verbindungen, Dashboard (mit Client und PAT)', async () => {
    const f = await fullFlow(user, srv.url)
    expect(f.tok.status, f.tok.text).toBe(200)
    expectContract('consent-info', f.flow.info, schemas.consent)
    const conns = expectContract('connections', await user.request('/api/me/connections'), schemas.connections)
    expect(conns.items.some(c => c.clientId === f.clientId)).toBe(true)
    const dash = expectContract('dashboard', await user.request('/api/dashboard'), schemas.dashboard)
    expect(dash.clients.length).toBeGreaterThan(0)
  })
  it('Audit: Liste und Seitenform', async () => {
    const a = expectContract('audit', await user.request('/api/audit'), schemas.audit)
    expect(a.items.length).toBeGreaterThan(0)
    expectContract('audit (Filter)', await user.request('/api/audit?category=management&limit=1'), schemas.audit)
  })
})

describe('Adminrouten', () => {
  it('Nutzer, Einladungen, Einstellungen', async () => {
    const users = expectContract('admin users', await admin.request('/api/admin/users'), schemas.users)
    expect(users.items.map(u => u.email).sort()).toEqual(['admin@example.com', 'user@example.com'])
    const invites = expectContract('admin invites', await admin.request('/api/admin/invites'), schemas.invites)
    expect(invites.items.some(i => i.status === 'used')).toBe(true)
    expect(expectContract('settings', await admin.request('/api/admin/settings'), schemas.settings)['ssrf.allow']).toEqual(['127.0.0.0/8'])
    expectContract('settings put', await admin.request('/api/admin/settings', { method: 'PUT', body: { 'stdio.enabled': false } }), schemas.settings)
  })
  it('Limits: Antwort ist ein AdminUser', async () => {
    const users = expectContract('admin users', await admin.request('/api/admin/users'), schemas.users)
    const u = users.items.find(x => x.email === 'user@example.com')!
    expectContract('limits put', await admin.request(`/api/admin/users/${u.id}/limits`, { method: 'PUT', body: { maxUpstreams: 10 } }), schemas.users.shape.items.element)
  })
  it('DCR-Richtlinie, Allowlist, OAuth-Clients', async () => {
    expectContract('policy', await admin.request('/api/admin/oauth/policy'), schemas.policy)
    expectContract('policy put', await admin.request('/api/admin/oauth/policy', { method: 'PUT', body: { mode: 'open' } }), schemas.policy)
    const al = expectContract('allowlist', await admin.request('/api/admin/oauth/allowlist'), schemas.allowlist)
    expect(al.items.length).toBeGreaterThan(0)
    expectContract('allowlist add', await admin.request('/api/admin/oauth/allowlist', { body: { label: 'T', namePattern: 'contract-*', redirectPatterns: ['http://127.0.0.1:*/*'] } }), schemas.allowlist.shape.items.element, 201)
    const clients = expectContract('oauth clients', await admin.request('/api/admin/oauth/clients'), schemas.oauthClients)
    expect(clients.items.length).toBeGreaterThan(0)
  })
  it('Audit und Dashboard des Admins', async () => {
    expectContract('audit', await admin.request('/api/audit'), schemas.audit)
    expectContract('dashboard', await admin.request('/api/dashboard'), schemas.dashboard)
    expectContract('connections', await admin.request('/api/me/connections'), schemas.connections)
  })
})

describe('Fehlerformen', () => {
  it('Nitro-Fehler tragen statusCode, statusMessage und data.code', async () => {
    for (const [label, r, status, code] of [
      ['404 Upstream', await user.request('/api/upstreams/gibtsnicht'), 404, 'not_found'],
      ['403 Admin-Route', await user.request('/api/admin/users'), 403, 'forbidden'],
      ['422 Validierung', await user.request('/api/upstreams', { body: { name: 'x', slug: 'Bad_Slug', type: 'http', url: fake.url } }), 422, 'validation'],
    ] as const) {
      expect(r.status, label).toBe(status)
      const body = schemas.apiError.parse(r.json)
      expect(body.statusCode, label).toBe(status)
      expect(body.data?.code, label).toBe(code)
    }
  })
  it('ohne Sitzung 401', async () => {
    expect((await api(srv.url).request('/api/upstreams')).status).toBe(401)
    expect((await api(srv.url).request('/api/me/capabilities')).status).toBe(401)
  })
})
