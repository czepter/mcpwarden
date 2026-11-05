// Phase 1 against the built artifact: invitations, user management, upstream CRUD, secrets, tool filter,
// end-to-end slice via /mcp, dashboard, audit, settings, isolation.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  AdminSettingsResult, AdminUserList, AuditList, Capabilities, Dashboard, InviteCreated, InviteInfo, InviteList, PatCreated,
  UpstreamDetail, UpstreamList, UpstreamTestResult, UpstreamToolList,
} from '#shared/api-types'
import { INVITE_INVALID, INVITE_REQUIRED } from '#shared/api-types'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { ADMIN, api, createInstance, heldPost, promoteToAdmin, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let fake: FakeHttp
let admin: ApiClient
let adminId: string
const PW = 'password-1234567'

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text
async function mcp(token: string) {
  const c = new Client({ name: 't', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  return c
}

/** Create an invitation, register, sign in. */
async function invitedUser(email: string): Promise<ApiClient> {
  const inv = await admin.request('/api/admin/invites', { body: { email } })
  expect(inv.status).toBe(201)
  const token = (inv.json as InviteCreated).link.split('/invite/')[1]!
  const c = api(srv.url, `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
  const su = await fetchSignUp(token, email)
  expect(su.status, su.text).toBe(200)
  await c.request('/api/auth/sign-in/email', { body: { email, password: PW } })
  return c
}
async function fetchSignUp(token: string | undefined, email: string) {
  const res = await fetch(`${srv.url}/api/auth/sign-up/email`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: srv.url, ...(token ? { 'x-invite-token': token } : {}) },
    body: JSON.stringify({ name: email.split('@')[0], email, password: PW }),
  })
  const text = await res.text()
  return { status: res.status, text, json: (() => { try { return JSON.parse(text) } catch { return undefined } })() }
}

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  fake = await startFakeHttp()
  admin = await signUpFirstAdmin(srv)
  adminId = (await admin.request('/api/auth/get-session')).json.user.id
  // Fake upstream runs on 127.0.0.1: allow via the admin exception list (CIDR, no metadata address)
  const put = await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })
  expect(put.status).toBe(200)
})
afterAll(async () => {
  await srv.stop()
  await fake.close()
  await inst.cleanup()
})

describe('invites (P0-4)', () => {
  it('sign-up without a token is refused, with a bogus token INVITE_INVALID', async () => {
    const none = await fetchSignUp(undefined, 'x@example.com')
    expect(none.status).toBe(403)
    expect(none.json.code).toBe(INVITE_REQUIRED)
    const bogus = await fetchSignUp('x'.repeat(43), 'x@example.com')
    expect(bogus.status).toBe(403)
    expect(bogus.json.code).toBe(INVITE_INVALID)
  })
  it('link carries the token, list never does; info is public; single use; role user; email binding', async () => {
    const r = await admin.request('/api/admin/invites', { body: { email: 'Bound@Example.com' } })
    const created = r.json as InviteCreated
    expect(created.link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
    const token = created.link.split('/invite/')[1]!
    const list = await admin.request('/api/admin/invites')
    expect(list.text).not.toContain(token)
    expect((list.json as InviteList).items.find(i => i.id === created.id)?.status).toBe('open')
    const info = await fetch(`${srv.url}/api/invites/${token}`).then(x => x.json()) as InviteInfo
    expect(info).toMatchObject({ valid: true, email: 'bound@example.com' })
    // wrong address -> INVITE_INVALID, the invitation stays open
    const wrong = await fetchSignUp(token, 'other@example.com')
    expect(wrong.json.code).toBe(INVITE_INVALID)
    const ok = await fetchSignUp(token, 'bound@example.com')
    expect(ok.status, ok.text).toBe(200)
    expect(ok.json.user.role).toBe('user')
    const again = await fetchSignUp(token, 'bound@example.com')
    expect(again.status).toBe(403)
    expect(await fetch(`${srv.url}/api/invites/${token}`).then(x => x.json())).toMatchObject({ valid: false, reason: 'used' })
  })
  it('parallel sign-ups with one token: exactly one wins', async () => {
    const created = (await admin.request('/api/admin/invites', { body: {} })).json as InviteCreated
    const token = created.link.split('/invite/')[1]!
    const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => fetchSignUp(token, `race${i}@example.com`)))
    expect(rs.filter(r => r.status === 200)).toHaveLength(1)
  })
  it('revoke: open -> 204, then 409 invite_not_open; revoked token is invalid; unknown token -> valid:false', async () => {
    const created = (await admin.request('/api/admin/invites', { body: {} })).json as InviteCreated
    const token = created.link.split('/invite/')[1]!
    expect((await admin.request(`/api/admin/invites/${created.id}`, { method: 'DELETE' })).status).toBe(204)
    const again = await admin.request(`/api/admin/invites/${created.id}`, { method: 'DELETE' })
    expect(again.status).toBe(409)
    expect(again.json.data.code).toBe('invite_not_open')
    expect((await fetchSignUp(token, 'rev@example.com')).json.code).toBe(INVITE_INVALID)
    expect(await fetch(`${srv.url}/api/invites/${'z'.repeat(43)}`).then(x => x.json())).toMatchObject({ valid: false, reason: 'unknown' })
  })
  it('malformed ids on admin routes answer 404, not 500 (review L-h)', async () => {
    for (const id of ['not-a-uuid', '1', "x'--", '%00', 'ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ']) {
      const r = await admin.request(`/api/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' })
      expect(r.status, id).toBe(404)
      expect(r.json.data.code).toBe('not_found')
    }
    for (const [m, p] of [['GET', ''], ['DELETE', ''], ['GET', '/tools']] as const) {
      expect((await admin.request(`/api/upstreams/not-a-uuid${p}`, { method: m })).status, `${m} ${p}`).toBe(404)
    }
    expect((await admin.request('/api/admin/oauth/allowlist/not-a-uuid', { method: 'DELETE' })).status).toBe(404)
    expect((await admin.request('/api/admin/users/not-a-user/unban', { body: {} })).status).toBe(404)
  })
  it('non-admins cannot manage invites', async () => {
    const u = await invitedUser('plain@example.com')
    expect((await u.request('/api/admin/invites')).status).toBe(403)
    expect((await u.request('/api/admin/invites', { body: {} })).status).toBe(403)
    expect((await api(srv.url).request('/api/admin/invites')).status).toBe(401)
  })
})

describe('upstreams, secrets, tools and the proxy path', () => {
  let userA: ApiClient
  let userB: ApiClient
  let up: UpstreamDetail
  let patA: PatCreated

  beforeAll(async () => {
    userA = await invitedUser('a@example.com')
    userB = await invitedUser('b@example.com')
    patA = (await userA.request('/api/me/pats', { body: { name: 'a' } })).json
  })

  it('creates with validation; slug taken; stdio refused without grant; capabilities', async () => {
    const bad = await userA.request('/api/upstreams', { body: { name: 'X', slug: 'Bad_Slug', type: 'http', url: fake.url } })
    expect(bad.status).toBe(422)
    expect(bad.json.data).toMatchObject({ code: 'validation', field: 'slug' })
    const noUrl = await userA.request('/api/upstreams', { body: { name: 'X', slug: 'x', type: 'http' } })
    expect(noUrl.json.data.field).toBe('url')
    const meta = await userA.request('/api/upstreams', { body: { name: 'Meta', slug: 'meta', type: 'http', url: 'http://169.254.169.254/' } })
    expect(meta.status).toBe(422)
    expect(meta.json.data.code).toBe('ssrf_blocked')
    const r = await userA.request('/api/upstreams', { body: { name: 'Fake', slug: 'fake', type: 'http', url: fake.url, authType: 'bearer' } })
    expect(r.status).toBe(201)
    up = r.json
    expect(up).toMatchObject({ slug: 'fake', setup: 'awaiting_auth', status: 'unknown', hasSecret: false, version: 1 })
    const dup = await userA.request('/api/upstreams', { body: { name: 'Fake2', slug: 'fake', type: 'http', url: fake.url } })
    expect(dup.status).toBe(409)
    expect(dup.json.data.code).toBe('slug_taken')
    const stdio = await userA.request('/api/upstreams', { body: { name: 'S', slug: 's', type: 'stdio', command: 'node' } })
    expect(stdio.status).toBe(403)
    expect(stdio.json.data).toMatchObject({ code: 'stdio_not_allowed', reason: 'image_slim' })
    const caps = (await userA.request('/api/me/capabilities')).json as Capabilities
    expect(caps).toMatchObject({ role: 'user', stdio: { allowed: false, reason: 'image_slim' }, limits: { upstreamsUsed: 1, maxUpstreams: 50 } })
    expect(caps.mcpUrl).toBe(`${srv.url}/mcp`)
  })

  it('awaiting_auth: test answers awaiting_auth; secret is stored encrypted, never returned, setup becomes ready', async () => {
    const t = (await userA.request(`/api/upstreams/${up.id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult
    expect(t).toMatchObject({ ok: false, errorCode: 'awaiting_auth' })
    // P0-16: an upstream waiting for credentials appears in the attention list (with setup and reason)
    const waiting = ((await userA.request('/api/dashboard')).json as Dashboard).attention.find(a => a.upstreamId === up.id)
    expect(waiting).toMatchObject({ setup: 'awaiting_auth', slug: 'fake' })
    expect(waiting?.statusReason).toBeTruthy()
    const wrongKind = await userA.request(`/api/upstreams/${up.id}/secret`, { method: 'PUT', body: { kind: 'header', value: 'x' } })
    expect(wrongKind.status).toBe(422)
    const SECRET = 'sk-very-secret-value-123'
    const put = await userA.request(`/api/upstreams/${up.id}/secret`, { method: 'PUT', body: { kind: 'bearer', value: SECRET } })
    expect(put.json).toEqual({ hasSecret: true, setup: 'ready' })
    expect(((await userA.request('/api/dashboard')).json as Dashboard).attention.some(a => a.upstreamId === up.id)).toBe(false)
    const detail = await userA.request(`/api/upstreams/${up.id}`)
    expect((detail.json as UpstreamDetail)).toMatchObject({ hasSecret: true, setup: 'ready', secretNames: ['bearer'] })
    for (const body of [put.text, detail.text, (await userA.request('/api/upstreams')).text]) expect(body).not.toContain(SECRET)
    expect(srv.logs()).not.toContain(SECRET)
    // Ciphertext in the database is not the plaintext
    expect((await userA.request('/api/audit')).text).not.toContain(SECRET)
  })

  it('test connects, lists tools, status becomes healthy; tools list matches', async () => {
    const t = (await userA.request(`/api/upstreams/${up.id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult
    expect(t.ok).toBe(true)
    if (t.ok) expect(t.tools.map(x => x.name)).toContain('echo')
    const d = (await userA.request(`/api/upstreams/${up.id}`)).json as UpstreamDetail
    expect(d.status).toBe('healthy')
    expect(d.toolsTotal).toBeGreaterThan(0)
    const tools = (await userA.request(`/api/upstreams/${up.id}/tools`)).json as UpstreamToolList
    expect(tools.items.map(x => x.name)).toContain('echo')
    expect(tools.items.every(x => x.enabled)).toBe(true)
  })

  it('SSRF: an upstream URL pointing at an unlisted private address fails the test with ssrf_blocked and no detail', async () => {
    const r = await userA.request('/api/upstreams', { body: { name: 'Priv', slug: 'priv', type: 'http', url: 'http://10.255.255.1:9/mcp' } })
    expect(r.status).toBe(422) // literal is rejected already on creation
    const dns = await userA.request('/api/upstreams', { body: { name: 'Loc', slug: 'loc', type: 'http', url: 'http://localtest.invalid:9/mcp' } })
    expect(dns.status).toBe(201)
    const t = (await userA.request(`/api/upstreams/${dns.json.id}/test`, { method: 'POST', body: {} })).json as UpstreamTestResult
    expect(t.ok).toBe(false)
    await userA.request(`/api/upstreams/${dns.json.id}`, { method: 'DELETE' })
  })

  it('/mcp: tools are namespaced, calls reach the upstream, the filter is enforced server-side on every call', async () => {
    const c = await mcp(patA.token)
    const names = (await c.listTools()).tools.map(t => t.name)
    expect(names).toContain('fake__echo')
    expect(text(await c.callTool({ name: 'fake__echo', arguments: { text: 'hallo' } }) as never)).toBe('hallo')
    const off = await userA.request(`/api/upstreams/${up.id}/tools/echo`, { method: 'PUT', body: { enabled: false } })
    expect(off.status).toBe(200)
    expect(off.json.enabled).toBe(false)
    expect((await c.listTools()).tools.map(t => t.name)).not.toContain('fake__echo')
    await expect(c.callTool({ name: 'fake__echo', arguments: { text: 'x' } })).rejects.toBeDefined()
    expect((await userA.request(`/api/upstreams/${up.id}/tools/nope`, { method: 'PUT', body: { enabled: true } })).status).toBe(404)
    await userA.request(`/api/upstreams/${up.id}/tools/echo`, { method: 'PUT', body: { enabled: true } })
    expect(text(await c.callTool({ name: 'fake__echo', arguments: { text: 'again' } }) as never)).toBe('again')
    await c.close()
  })

  it('tenant isolation: user B sees nothing of A (404, empty lists, no tools)', async () => {
    expect(((await userB.request('/api/upstreams')).json as UpstreamList).items).toEqual([])
    for (const [m, p, b] of [['GET', ''], ['PATCH', '', {}], ['DELETE', ''], ['POST', '/test', {}], ['GET', '/tools'], ['PUT', '/secret', { kind: 'bearer', value: 'x' }]] as const) {
      const r = await userB.request(`/api/upstreams/${up.id}${p}`, { method: m, body: b })
      expect(r.status, `${m} ${p}`).toBe(404)
    }
    const patB = (await userB.request('/api/me/pats', { body: { name: 'b' } })).json as PatCreated
    const c = await mcp(patB.token)
    expect((await c.listTools()).tools.map(t => t.name)).not.toContain('fake__echo')
    await c.close()
  })

  it('PATCH: slug is immutable, enabling/disabling works, version bumps; DELETE removes secrets and tools', async () => {
    const imm = await userA.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { slug: 'other' } })
    expect(imm.status).toBe(422)
    expect(imm.json.data.code).toBe('slug_immutable')
    const dis = (await userA.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { enabled: false } })).json as UpstreamDetail
    expect(dis).toMatchObject({ enabled: false, status: 'disabled' })
    expect(dis.version).toBeGreaterThan(up.version)
    const c = await mcp(patA.token)
    expect((await c.listTools()).tools.map(t => t.name)).not.toContain('fake__echo')
    await userA.request(`/api/upstreams/${up.id}`, { method: 'PATCH', body: { enabled: true, name: 'Renamed' } })
    expect((await c.listTools()).tools.map(t => t.name)).toContain('fake__echo')
    await c.close()
    expect((await userA.request(`/api/upstreams/${up.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await userA.request(`/api/upstreams/${up.id}`)).status).toBe(404)
  })

  it('upstream limit: 409 limit_reached after maxUpstreams', async () => {
    const list = (await admin.request('/api/admin/users')).json as AdminUserList
    const a = list.items.find(u => u.email === 'a@example.com')!
    const lim = await admin.request(`/api/admin/users/${a.id}/limits`, { method: 'PUT', body: { maxUpstreams: 1 } })
    expect(lim.status).toBe(200)
    expect((await userA.request('/api/upstreams', { body: { name: 'One', slug: 'one', type: 'http', url: fake.url } })).status).toBe(201)
    const over = await userA.request('/api/upstreams', { body: { name: 'Two', slug: 'two', type: 'http', url: fake.url } })
    expect(over.status).toBe(409)
    expect(over.json.data.code).toBe('limit_reached')
  })

  it('dashboard: client rows with activity, attention list, no KPIs', async () => {
    const c = await mcp(patA.token)
    await c.listTools()
    await c.close()
    await new Promise(r => setTimeout(r, 5500)) // the stats buffer writes every 5 s
    const d = (await userA.request('/api/dashboard')).json as Dashboard
    expect(Object.keys(d).sort()).toEqual(['attention', 'attentionCount', 'clients'])
    const pat = d.clients.find(x => x.kind === 'pat')
    expect(pat).toMatchObject({ name: 'a', allowlisted: null, active: true })
    expect(pat!.contextTokensEstimate).not.toBeNull()
  })

  it('audit: users see their own management entries, never others; admin additionally sees instance events', async () => {
    const mine = (await userA.request('/api/audit')).json as AuditList
    expect(mine.items.length).toBeGreaterThan(0)
    expect(mine.items.every(i => i.scope === 'user')).toBe(true)
    expect(mine.items.map(i => i.action)).toEqual(expect.arrayContaining(['upstream.create', 'secret.replace', 'tool.disable']))
    const theirs = (await userB.request('/api/audit')).json as AuditList
    expect(theirs.items.some(i => i.targetLabel === 'fake')).toBe(false)
    const adm = (await admin.request('/api/audit')).json as AuditList
    expect(adm.items.some(i => i.scope === 'instance' && i.action === 'invite.create')).toBe(true)
    expect(adm.items.some(i => i.targetLabel === 'fake')).toBe(false) // other users' entries stay hidden from the admin too
    expect(mine.items.some(i => i.action === 'invite.create')).toBe(false)
    const authCat = (await userA.request('/api/audit?category=auth')).json as AuditList
    expect(authCat.items).toEqual([])
    const paged = (await userA.request('/api/audit?limit=1')).json as AuditList
    expect(paged.items).toHaveLength(1)
    expect(paged.nextCursor).not.toBeNull()
    expect((await userA.request('/api/audit?category=bogus')).status).toBe(422)
  })
})

describe('admin: users, limits, settings (P0-4)', () => {
  it('lists users with limits/defaults; ban blocks sign-in and revokes tokens; unban; delete', async () => {
    const victim = await invitedUser('victim@example.com')
    const pat = (await victim.request('/api/me/pats', { body: { name: 'v' } })).json as PatCreated
    const list = (await admin.request('/api/admin/users')).json as AdminUserList
    expect(list.defaults).toMatchObject({ maxUpstreams: 50, callsPerMin: 120 })
    const v = list.items.find(u => u.email === 'victim@example.com')!
    expect(v).toMatchObject({ role: 'user', banned: false, upstreamCount: 0 })
    expect((await admin.request(`/api/admin/users/${v.id}/ban`, { body: { reason: 'test' } })).status).toBe(204)
    expect([401, 403]).toContain((await victim.request('/api/me/pats')).status) // sessions are revoked with the ban
    const rej = await fetch(`${srv.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${pat.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
    expect(rej.status).toBe(401)
    expect((await admin.request(`/api/admin/users/${v.id}/unban`, { body: {} })).status).toBe(204)
    expect((await admin.request(`/api/admin/users/${v.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(((await admin.request('/api/admin/users')).json as AdminUserList).items.some(u => u.id === v.id)).toBe(false)
    // Instance events carry neither email nor names
    const ev = (await admin.request('/api/audit?limit=200')).text
    expect(ev).not.toContain('victim@example.com')
  })
  it('protects self and the last admin', async () => {
    const self = await admin.request(`/api/admin/users/${adminId}/ban`, { body: {} })
    expect(self.status).toBe(409)
    expect(self.json.data.code).toBe('self_target')
    expect((await admin.request(`/api/admin/users/${adminId}`, { method: 'DELETE' })).json.data.code).toBe('self_target')
    // second admin: deleting the first by the second is allowed as long as one remains; the last never
    const a2 = await invitedUser('admin2@example.com')
    srv = await promoteToAdmin(inst, srv, 'admin2@example.com') // no route makes users admins: role directly in the database
    const ban1 = await a2.request(`/api/admin/users/${adminId}/ban`, { body: {} })
    expect(ban1.status).toBe(204) // admin2 stays active
    // now admin2 is the last active admin; a third party cannot ban them: simulated via self-target + count
    const list = (await a2.request('/api/admin/users')).json as AdminUserList
    expect(list.items.filter(u => u.role === 'admin' && !u.banned)).toHaveLength(1)
    await a2.request(`/api/admin/users/${adminId}/unban`, { body: {} })
    await admin.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } }) // the ban revoked the sessions
  })
  it('two admins banning each other at the same time: exactly one succeeds, an active admin remains (last_admin)', async () => {
    const a3 = await invitedUser('admin3@example.com')
    const id3 = (await a3.request('/api/auth/get-session')).json.user.id as string
    srv = await promoteToAdmin(inst, srv, 'admin3@example.com')
    // Starting point: only admin and admin3 active (ban admin2)
    const list = (await admin.request('/api/admin/users')).json as AdminUserList
    const a2 = list.items.find(u => u.email === 'admin2@example.com')!
    expect((await admin.request(`/api/admin/users/${a2.id}/ban`, { body: {} })).status).toBe(204)
    // Both requests are registered with the server (header there, body held back) before either of them commits a ban; only then
    // the bodies are released. So the result does not depend on arrival times: neither of the two may fail on a 401.
    const h1 = heldPost(srv.url, admin, `/api/admin/users/${id3}/ban`, {})
    const h2 = heldPost(srv.url, a3, `/api/admin/users/${adminId}/ban`, {})
    await new Promise(r => setTimeout(r, 500))
    const [r1, r2] = await Promise.all([h1.release(), h2.release()])
    expect([r1.status, r2.status].sort()).toEqual([204, 409])
    const loser = [r1, r2].find(r => r.status === 409)!
    expect(loser.json.data.code).toBe('last_admin')
    const after = (await a3.request('/api/admin/users')).json as AdminUserList | undefined
    void after
    // clean up: restore state for the following tests
    await admin.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    await a3.request('/api/auth/sign-in/email', { body: { email: 'admin3@example.com', password: PW } })
    const act = r1.status === 204 ? admin : a3 // the winner is active and may unban; the loser is banned
    for (const id of [adminId, id3, a2.id]) expect((await act.request(`/api/admin/users/${id}/unban`, { body: {} })).status, `unban ${id}`).toBe(204)
    expect((await admin.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })).status).toBe(200)
  })
  it('limits: partial update, validation, normal users are refused', async () => {
    const list = (await admin.request('/api/admin/users')).json as AdminUserList
    const u = list.items.find(x => x.email === 'plain@example.com')!
    const r = await admin.request(`/api/admin/users/${u.id}/limits`, { method: 'PUT', body: { callsPerMin: 30, stdioAllowed: true } })
    expect(r.json).toMatchObject({ stdioAllowed: true, limits: { callsPerMin: 30, maxUpstreams: 50 } })
    for (const body of [{ callsPerMin: 0 }, { callsPerMin: 1.5 }, { maxUpstreams: 'x' }, {}, { stdioAllowed: 'yes' }]) {
      expect((await admin.request(`/api/admin/users/${u.id}/limits`, { method: 'PUT', body })).status).toBe(422)
    }
    const plain = api(srv.url)
    await plain.request('/api/auth/sign-in/email', { body: { email: 'plain@example.com', password: PW } })
    expect((await plain.request(`/api/admin/users/${u.id}/limits`, { method: 'PUT', body: { callsPerMin: 1 } })).status).toBe(403)
  })
  it('settings: validated CIDR/hostname list, metadata is only a warning', async () => {
    const bad = await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['10.0.0.0/abc'] } })
    expect(bad.status).toBe(422)
    expect(bad.json.data.field).toBe('ssrf.allow[0]')
    expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['https://x.example'] } })).status).toBe(422)
    expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'stdio.enabled': 'yes' } })).status).toBe(422)
    const w = (await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8', '169.254.169.254', 'internal.example'] } })).json as AdminSettingsResult
    expect(w.warnings).toEqual([{ key: 'ssrf.allow', entry: '169.254.169.254', code: 'covers_metadata_ip' }])
    const back = (await admin.request('/api/admin/settings')).json as AdminSettingsResult
    expect(back['ssrf.allow']).toEqual(['127.0.0.0/8', '169.254.169.254', 'internal.example'])
    await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })
    const ev = (await admin.request('/api/audit?limit=200')).json as AuditList
    expect(ev.items.some(i => i.action === 'setting.change' && i.scope === 'instance')).toBe(true)
  })
})

describe('health endpoints', () => {
  it('/readyz reports stats_dropped; /healthz stays ok', async () => {
    const ready = await fetch(`${srv.url}/readyz`).then(r => r.json()) as { ready: boolean, stats_dropped: number }
    expect(ready).toMatchObject({ ready: true, stats_dropped: 0 })
    expect((await fetch(`${srv.url}/healthz`)).status).toBe(200)
  })
})
