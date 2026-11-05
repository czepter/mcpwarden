// Full-stack smoke against a RUNNING server (HTTP only, no access to internals). Used from three places:
//  - tests/integration/smoke.test.ts   (built artifact on PGlite AND Postgres, per TEST_BACKEND)
//  - tests/smoke/run.ts                (`pnpm smoke`, against a fresh instance or SMOKE_BASE_URL)
//  - tests/e2e/compose-smoke.sh        (container from compose.yaml)
// Flow: first registration (admin) -> login -> invitation -> second user with X-Invite-Token -> PAT -> upstream via a
// fake MCP (SSRF exception by the admin) -> OAuth 2.1 (DCR, PKCE S256, consent, token, refresh) -> /mcp tools/list + tools/call
// -> tenant isolation -> wrong audience -> immediate revocation.
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Capabilities, ConnectionList, Dashboard, InviteCreated, PatCreated, PublicConfig, UpstreamDetail, UpstreamList } from '../../shared/api-types'
import { INVITE_INVALID, INVITE_REQUIRED } from '../../shared/api-types'
import type { FakeHttp } from '../fixtures/fake-upstream/http'
import { api, ADMIN, type ApiClient } from '../integration/harness'
import { authorizeAndConsent, decodeJwt, exchangeCode, pkce, refresh, registerClient } from '../helpers/oauth-client'

export interface SmokeOptions {
  baseUrl: string
  /** Fake upstream in the test process; `url` is the address under which the SERVER reaches it (in the container: bridge gateway). */
  fake: Pick<FakeHttp, 'state'> & { url: string }
  /** CIDR/host for `ssrf.allow` that covers the fake address. */
  ssrfAllow: string[]
  /** Password of the test users (at least 12 characters). */
  password?: string
}
export interface SmokeStep { name: string, run: () => Promise<void> }

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text

export function smokeSteps(o: SmokeOptions): SmokeStep[] {
  const base = o.baseUrl
  const mcpUrl = new URL(`${base}/mcp`)
  const PW = o.password ?? 'smoke-password-1234'
  const steps: SmokeStep[] = []
  const step = (name: string, run: () => Promise<void>) => { steps.push({ name, run }) }

  let admin: ApiClient
  let alice: ApiClient
  let bob: ApiClient
  let upstream: UpstreamDetail
  let patA: PatCreated
  let patB: PatCreated
  let oauth: { clientId: string, access: string, refresh: string }

  const rpc = (token: string | undefined, body: unknown) => fetch(mcpUrl, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
  })
  const toolsListStatus = async (token?: string) => (await rpc(token, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })).status
  async function mcp(token: string) {
    const c = new Client({ name: 'smoke', version: '1' }, { versionNegotiation: { mode: 'auto' } })
    await c.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    return c
  }
  async function signUp(token: string | undefined, user: { name: string, email: string, password: string }) {
    const res = await fetch(`${base}/api/auth/sign-up/email`, {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base, ...(token ? { 'x-invite-token': token } : {}) }, body: JSON.stringify(user),
    })
    const t = await res.text()
    return { status: res.status, text: t, json: (() => { try { return JSON.parse(t) } catch { return undefined } })() }
  }
  async function invite(email: string): Promise<string> {
    const r = await admin.request('/api/admin/invites', { body: { email } })
    assert.equal(r.status, 201, r.text)
    return (r.json as InviteCreated).link.split('/invite/')[1]!
  }
  async function invitedUser(email: string, name: string): Promise<ApiClient> {
    const token = await invite(email)
    const su = await signUp(token, { name, email, password: PW })
    assert.equal(su.status, 200, su.text)
    assert.equal(su.json.user.role, 'user')
    const c = api(base, '198.51.100.30')
    assert.equal((await c.request('/api/auth/sign-in/email', { body: { email, password: PW } })).status, 200)
    return c
  }

  step('fresh instance: registration is open (public-config.registrationOpen)', async () => {
    const r = await api(base).request('/api/public-config')
    assert.equal(r.status, 200)
    assert.equal((r.json as PublicConfig).registrationOpen, true)
  })

  step('first user registers without an invitation and becomes admin', async () => {
    const c = api(base)
    const r = await c.request('/api/auth/sign-up/email', { body: ADMIN })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.user.role, 'admin')
  })

  step('Login (cookie session) and get-session', async () => {
    admin = api(base)
    const r = await admin.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    assert.equal(r.status, 200, r.text)
    const s = await admin.request('/api/auth/get-session')
    assert.equal(s.json.user.email, ADMIN.email)
    assert.equal(s.json.user.role, 'admin')
    assert.equal((await api(base).request('/api/upstreams')).status, 401)
  })

  step('afterwards registration is closed (registrationOpen=false, INVITE_REQUIRED)', async () => {
    assert.equal(((await api(base).request('/api/public-config')).json as PublicConfig).registrationOpen, false)
    const none = await signUp(undefined, { name: 'X', email: 'x@example.com', password: PW })
    assert.equal(none.status, 403)
    assert.equal(none.json.code, INVITE_REQUIRED)
    const bogus = await signUp('x'.repeat(43), { name: 'X', email: 'x@example.com', password: PW })
    assert.equal(bogus.json.code, INVITE_INVALID)
  })

  step('Admin: set SSRF exception for the fake upstream', async () => {
    const r = await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': o.ssrfAllow } })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json['ssrf.allow'], o.ssrfAllow)
  })

  step('create invitation and register second user (alice) with X-Invite-Token; token is single-use', async () => {
    const token = await invite('alice@example.com')
    const info = await fetch(`${base}/api/invites/${token}`).then(r => r.json())
    assert.equal(info.valid, true)
    const su = await signUp(token, { name: 'Alice', email: 'alice@example.com', password: PW })
    assert.equal(su.status, 200, su.text)
    assert.equal(su.json.user.role, 'user')
    assert.equal((await signUp(token, { name: 'Alice2', email: 'alice@example.com', password: PW })).status, 403)
    assert.deepEqual(await fetch(`${base}/api/invites/${token}`).then(r => r.json()), { valid: false, reason: 'used' })
    alice = api(base, '198.51.100.31')
    assert.equal((await alice.request('/api/auth/sign-in/email', { body: { email: 'alice@example.com', password: PW } })).status, 200)
    assert.equal((await alice.request('/api/admin/users')).status, 403)
  })

  step('third user (bob) for tenant isolation', async () => {
    bob = await invitedUser('bob@example.com', 'Bob')
  })

  step('create PAT: plaintext exactly once, list shows only the prefix', async () => {
    const r = await alice.request('/api/me/pats', { body: { name: 'smoke' } })
    assert.equal(r.status, 201, r.text)
    patA = r.json
    assert.match(patA.token, /^mcpw_pat_/)
    const list = await alice.request('/api/me/pats')
    assert.ok(!list.text.includes(patA.token))
    patB = (await bob.request('/api/me/pats', { body: { name: 'bob' } })).json
  })

  step('create upstream via the fake MCP, test (tools visible), capabilities', async () => {
    const r = await alice.request('/api/upstreams', { body: { name: 'Fake', slug: 'fake', type: 'http', url: o.fake.url, authType: 'none' } })
    assert.equal(r.status, 201, r.text)
    upstream = r.json
    const t = await alice.request(`/api/upstreams/${upstream.id}/test`, { method: 'POST', body: {} })
    assert.equal(t.json.ok, true, t.text)
    assert.ok((t.json.tools as Array<{ name: string }>).some(x => x.name === 'echo'))
    const d = (await alice.request(`/api/upstreams/${upstream.id}`)).json as UpstreamDetail
    assert.equal(d.status, 'healthy')
    const caps = (await alice.request('/api/me/capabilities')).json as Capabilities
    assert.equal(caps.limits.upstreamsUsed, 1)
  })

  step('/mcp without token: 401 with protected-resource metadata', async () => {
    const res = await rpc(undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    assert.equal(res.status, 401)
    assert.match(res.headers.get('www-authenticate') ?? '', /resource_metadata="[^"]+oauth-protected-resource/)
  })

  step('OAuth 2.1: DCR, PKCE S256, Consent, Token', async () => {
    const reg = await registerClient(base, { client_name: 'Smoke Client' })
    assert.equal(reg.status, 201, reg.text)
    const clientId = reg.json.client_id as string
    const { verifier, challenge } = pkce()
    const resource = `${base}/mcp`
    const r = await authorizeAndConsent(alice, base, { clientId, challenge, resource, state: 'smoke-state' })
    assert.equal(r.step, 'done', JSON.stringify(r))
    assert.equal(r.step === 'done' && r.state, 'smoke-state')
    assert.equal(r.step === 'done' && r.info.status, 200)
    const code = r.step === 'done' ? r.code : null
    assert.ok(code, 'authorization code missing')
    // PKCE: a wrong verifier does not redeem the code
    const bad = await exchangeCode(base, { clientId, code, verifier: pkce().verifier, resource })
    assert.ok(bad.status >= 400, 'wrong code_verifier must fail')
    const reg2 = await registerClient(base, { client_name: 'Smoke Client' })
    const r2 = await authorizeAndConsent(alice, base, { clientId: reg2.json.client_id, challenge, resource })
    const tok = await exchangeCode(base, { clientId: reg2.json.client_id, code: (r2.step === 'done' ? r2.code : null)!, verifier, resource })
    assert.equal(tok.status, 200, tok.text)
    assert.equal(tok.json.token_type.toLowerCase(), 'bearer')
    assert.ok(tok.json.refresh_token, 'refresh_token missing (offline_access)')
    assert.ok([decodeJwt(tok.json.access_token).aud].flat().includes(resource), 'aud contains /mcp')
    oauth = { clientId: reg2.json.client_id, access: tok.json.access_token, refresh: tok.json.refresh_token }
  })

  step('refresh token rotates, new access token works', async () => {
    const r = await refresh(base, { clientId: oauth.clientId, refreshToken: oauth.refresh, resource: `${base}/mcp` })
    assert.equal(r.status, 200, r.text)
    assert.notEqual(r.json.refresh_token, oauth.refresh)
    assert.notEqual(r.json.access_token, oauth.access)
    assert.equal(await toolsListStatus(r.json.access_token), 200)
    oauth = { clientId: oauth.clientId, access: r.json.access_token, refresh: r.json.refresh_token }
  })

  step('/mcp tools/list and tools/call via OAuth token and via PAT reach the fake upstream', async () => {
    for (const token of [oauth.access, patA.token]) {
      const c = await mcp(token)
      const names = (await c.listTools()).tools.map(t => t.name)
      assert.ok(names.includes('fake__echo'), names.join(','))
      assert.equal(text(await c.callTool({ name: 'fake__echo', arguments: { text: 'hallo smoke' } }) as never), 'hallo smoke')
      assert.equal(text(await c.callTool({ name: 'fake__add', arguments: { a: 2, b: 3 } }) as never), '5')
      await c.close()
    }
    assert.ok((o.fake.state.calls.echo ?? 0) >= 2, 'the fake upstream saw the calls')
  })

  step('dashboard and audit reflect the usage (client + PAT, management entries)', async () => {
    const dash = (await alice.request('/api/dashboard')).json as Dashboard
    assert.ok(dash.clients.some(c => c.kind === 'oauth'))
    assert.ok(dash.clients.some(c => c.kind === 'pat'))
    const conns = (await alice.request('/api/me/connections')).json as ConnectionList
    assert.ok(conns.items.some(c => c.clientId === oauth.clientId))
    const audit = await alice.request('/api/audit')
    assert.equal(audit.status, 200)
    assert.ok((audit.json.items as Array<{ action: string }>).some(i => i.action.startsWith('upstream')))
  })

  step('tenant isolation: bob neither sees nor calls alice\'s upstream or tools', async () => {
    assert.deepEqual(((await bob.request('/api/upstreams')).json as UpstreamList).items, [])
    for (const [m, p, b] of [['GET', ''], ['PATCH', '', {}], ['DELETE', ''], ['POST', '/test', {}], ['GET', '/tools']] as const) {
      const r = await bob.request(`/api/upstreams/${upstream.id}${p}`, { method: m, body: b })
      assert.equal(r.status, 404, `${m} ${p}`)
    }
    const c = await mcp(patB.token)
    const names = (await c.listTools()).tools.map(t => t.name)
    assert.ok(!names.includes('fake__echo'), names.join(','))
    await assert.rejects(c.callTool({ name: 'fake__echo', arguments: { text: 'x' } }))
    await c.close()
    // bob's dashboard also shows no clients of alice
    const dash = (await bob.request('/api/dashboard')).json as Dashboard
    assert.ok(!dash.clients.some(x => x.id === oauth.clientId))
  })

  step('wrong audience: foreign resource gets no code, tampered aud is rejected with 401', async () => {
    const reg = await registerClient(base)
    const r = await authorizeAndConsent(alice, base, { clientId: reg.json.client_id, challenge: pkce().challenge, resource: `${base}/other` })
    assert.equal((r as { code?: string | null }).code ?? null, null)
    const [h, p, s] = oauth.access.split('.') as [string, string, string]
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    const forged = [h, Buffer.from(JSON.stringify({ ...claims, aud: 'http://elsewhere.example/mcp' })).toString('base64url'), s].join('.')
    assert.equal(await toolsListStatus(forged), 401)
    assert.equal(await toolsListStatus(`${h}.${p}.${s.slice(0, -4)}AAAA`), 401)
  })

  step('revocation takes effect immediately: PAT and OAuth consent => 401 on the next call', async () => {
    assert.equal(await toolsListStatus(patA.token), 200)
    assert.equal((await alice.request(`/api/me/pats/${patA.id}`, { method: 'DELETE' })).status, 204)
    assert.equal(await toolsListStatus(patA.token), 401)
    assert.equal(await toolsListStatus(oauth.access), 200)
    assert.equal((await alice.request(`/api/me/connections/${oauth.clientId}`, { method: 'DELETE' })).status, 204)
    assert.equal(await toolsListStatus(oauth.access), 401)
    const again = await refresh(base, { clientId: oauth.clientId, refreshToken: oauth.refresh })
    assert.ok(again.status >= 400, 'refresh after revocation must fail')
    // bob's token was never affected
    assert.equal(await toolsListStatus(patB.token), 200)
  })

  step('ban user: token invalid immediately and still revoked after unbanning; new credentials work', async () => {
    const users = (await admin.request('/api/admin/users')).json.items as Array<{ id: string, email: string }>
    const bobId = users.find(u => u.email === 'bob@example.com')!.id
    assert.equal((await admin.request(`/api/admin/users/${bobId}/ban`, { body: { reason: 'smoke' } })).status, 204)
    assert.equal(await toolsListStatus(patB.token), 401)
    assert.equal((await admin.request(`/api/admin/users/${bobId}/unban`, { body: {} })).status, 204)
    assert.equal(await toolsListStatus(patB.token), 401) // unbanning does not revive revoked credentials (spec P0-4)
    const again = api(base, '198.51.100.32')
    assert.equal((await again.request('/api/auth/sign-in/email', { body: { email: 'bob@example.com', password: PW } })).status, 200)
    const fresh = (await again.request('/api/me/pats', { body: { name: 'bob-new' } })).json as PatCreated
    assert.equal(await toolsListStatus(fresh.token), 200)
  })

  return steps
}
