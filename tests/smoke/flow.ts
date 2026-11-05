// Full-Stack-Smoke gegen einen LAUFENDEN Server (nur HTTP, kein Zugriff auf Interna). Wird von drei Stellen benutzt:
//  - tests/integration/smoke.test.ts   (gebautes Artefakt auf PGlite UND Postgres, je TEST_BACKEND)
//  - tests/smoke/run.ts                (`pnpm smoke`, gegen eine frische Instanz oder SMOKE_BASE_URL)
//  - tests/e2e/compose-smoke.sh        (Container aus compose.yaml)
// Ablauf: Erst-Registrierung (Admin) -> Login -> Einladung -> zweiter Nutzer mit X-Invite-Token -> PAT -> Upstream ueber ein
// Fake-MCP (SSRF-Ausnahme durch den Admin) -> OAuth 2.1 (DCR, PKCE S256, Consent, Token, Refresh) -> /mcp tools/list + tools/call
// -> Mandantentrennung -> falsche Audience -> sofortiger Widerruf.
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type { Capabilities, ConnectionList, Dashboard, InviteCreated, PatCreated, PublicConfig, UpstreamDetail, UpstreamList } from '../../shared/api-types'
import { INVITE_INVALID, INVITE_REQUIRED } from '../../shared/api-types'
import type { FakeHttp } from '../fixtures/fake-upstream/http'
import { api, ADMIN, type ApiClient } from '../integration/harness'
import { authorizeAndConsent, decodeJwt, exchangeCode, pkce, refresh, registerClient } from '../helpers/oauth-client'

export interface SmokeOptions {
  baseUrl: string
  /** Fake-Upstream im Testprozess; `url` ist die Adresse, unter der der SERVER es erreicht (im Container: Bridge-Gateway). */
  fake: Pick<FakeHttp, 'state'> & { url: string }
  /** CIDR/Host fuer `ssrf.allow`, der die Fake-Adresse abdeckt. */
  ssrfAllow: string[]
  /** Passwort der Testnutzer (mind. 12 Zeichen). */
  password?: string
}
export interface SmokeStep { name: string, run: () => Promise<void> }

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text

export function smokeSteps(o: SmokeOptions): SmokeStep[] {
  const base = o.baseUrl
  const mcpUrl = new URL(`${base}/mcp`)
  const PW = o.password ?? 'smoke-passwort-1234'
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

  step('frische Instanz: Registrierung ist offen (public-config.registrationOpen)', async () => {
    const r = await api(base).request('/api/public-config')
    assert.equal(r.status, 200)
    assert.equal((r.json as PublicConfig).registrationOpen, true)
  })

  step('erster Nutzer registriert sich ohne Einladung und wird Admin', async () => {
    const c = api(base)
    const r = await c.request('/api/auth/sign-up/email', { body: ADMIN })
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.user.role, 'admin')
  })

  step('Login (Cookie-Sitzung) und get-session', async () => {
    admin = api(base)
    const r = await admin.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
    assert.equal(r.status, 200, r.text)
    const s = await admin.request('/api/auth/get-session')
    assert.equal(s.json.user.email, ADMIN.email)
    assert.equal(s.json.user.role, 'admin')
    assert.equal((await api(base).request('/api/upstreams')).status, 401)
  })

  step('danach ist die Registrierung geschlossen (registrationOpen=false, INVITE_REQUIRED)', async () => {
    assert.equal(((await api(base).request('/api/public-config')).json as PublicConfig).registrationOpen, false)
    const none = await signUp(undefined, { name: 'X', email: 'x@example.com', password: PW })
    assert.equal(none.status, 403)
    assert.equal(none.json.code, INVITE_REQUIRED)
    const bogus = await signUp('x'.repeat(43), { name: 'X', email: 'x@example.com', password: PW })
    assert.equal(bogus.json.code, INVITE_INVALID)
  })

  step('Admin: SSRF-Ausnahme fuer das Fake-Upstream setzen', async () => {
    const r = await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': o.ssrfAllow } })
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json['ssrf.allow'], o.ssrfAllow)
  })

  step('Einladung anlegen und zweiten Nutzer (alice) mit X-Invite-Token registrieren; Token ist einmalig', async () => {
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

  step('dritter Nutzer (bob) fuer die Mandantentrennung', async () => {
    bob = await invitedUser('bob@example.com', 'Bob')
  })

  step('PAT anlegen: Klartext genau einmal, Liste zeigt nur den Praefix', async () => {
    const r = await alice.request('/api/me/pats', { body: { name: 'smoke' } })
    assert.equal(r.status, 201, r.text)
    patA = r.json
    assert.match(patA.token, /^mcpw_pat_/)
    const list = await alice.request('/api/me/pats')
    assert.ok(!list.text.includes(patA.token))
    patB = (await bob.request('/api/me/pats', { body: { name: 'bob' } })).json
  })

  step('Upstream ueber das Fake-MCP anlegen, testen (Tools sichtbar), Capabilities', async () => {
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

  step('/mcp ohne Token: 401 mit Protected-Resource-Metadata', async () => {
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
    assert.ok(code, 'Authorization Code fehlt')
    // PKCE: ein falscher Verifier loest den Code nicht ein
    const bad = await exchangeCode(base, { clientId, code, verifier: pkce().verifier, resource })
    assert.ok(bad.status >= 400, 'falscher code_verifier muss scheitern')
    const reg2 = await registerClient(base, { client_name: 'Smoke Client' })
    const r2 = await authorizeAndConsent(alice, base, { clientId: reg2.json.client_id, challenge, resource })
    const tok = await exchangeCode(base, { clientId: reg2.json.client_id, code: (r2.step === 'done' ? r2.code : null)!, verifier, resource })
    assert.equal(tok.status, 200, tok.text)
    assert.equal(tok.json.token_type.toLowerCase(), 'bearer')
    assert.ok(tok.json.refresh_token, 'refresh_token fehlt (offline_access)')
    assert.ok([decodeJwt(tok.json.access_token).aud].flat().includes(resource), 'aud enthaelt /mcp')
    oauth = { clientId: reg2.json.client_id, access: tok.json.access_token, refresh: tok.json.refresh_token }
  })

  step('Refresh-Token rotiert, neues Access-Token funktioniert', async () => {
    const r = await refresh(base, { clientId: oauth.clientId, refreshToken: oauth.refresh, resource: `${base}/mcp` })
    assert.equal(r.status, 200, r.text)
    assert.notEqual(r.json.refresh_token, oauth.refresh)
    assert.notEqual(r.json.access_token, oauth.access)
    assert.equal(await toolsListStatus(r.json.access_token), 200)
    oauth = { clientId: oauth.clientId, access: r.json.access_token, refresh: r.json.refresh_token }
  })

  step('/mcp tools/list und tools/call ueber OAuth-Token und ueber PAT erreichen das Fake-Upstream', async () => {
    for (const token of [oauth.access, patA.token]) {
      const c = await mcp(token)
      const names = (await c.listTools()).tools.map(t => t.name)
      assert.ok(names.includes('fake__echo'), names.join(','))
      assert.equal(text(await c.callTool({ name: 'fake__echo', arguments: { text: 'hallo smoke' } }) as never), 'hallo smoke')
      assert.equal(text(await c.callTool({ name: 'fake__add', arguments: { a: 2, b: 3 } }) as never), '5')
      await c.close()
    }
    assert.ok((o.fake.state.calls.echo ?? 0) >= 2, 'das Fake-Upstream hat die Aufrufe gesehen')
  })

  step('Dashboard und Audit spiegeln die Nutzung (Client + PAT, Management-Eintraege)', async () => {
    const dash = (await alice.request('/api/dashboard')).json as Dashboard
    assert.ok(dash.clients.some(c => c.kind === 'oauth'))
    assert.ok(dash.clients.some(c => c.kind === 'pat'))
    const conns = (await alice.request('/api/me/connections')).json as ConnectionList
    assert.ok(conns.items.some(c => c.clientId === oauth.clientId))
    const audit = await alice.request('/api/audit')
    assert.equal(audit.status, 200)
    assert.ok((audit.json.items as Array<{ action: string }>).some(i => i.action.startsWith('upstream')))
  })

  step('Mandantentrennung: bob sieht und ruft weder Upstream noch Tools von alice', async () => {
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
    // auch Bobs Dashboard zeigt keine Clients von alice
    const dash = (await bob.request('/api/dashboard')).json as Dashboard
    assert.ok(!dash.clients.some(x => x.id === oauth.clientId))
  })

  step('falsche Audience: fremde resource bekommt keinen Code, manipulierte aud wird mit 401 abgelehnt', async () => {
    const reg = await registerClient(base)
    const r = await authorizeAndConsent(alice, base, { clientId: reg.json.client_id, challenge: pkce().challenge, resource: `${base}/other` })
    assert.equal((r as { code?: string | null }).code ?? null, null)
    const [h, p, s] = oauth.access.split('.') as [string, string, string]
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    const forged = [h, Buffer.from(JSON.stringify({ ...claims, aud: 'http://elsewhere.example/mcp' })).toString('base64url'), s].join('.')
    assert.equal(await toolsListStatus(forged), 401)
    assert.equal(await toolsListStatus(`${h}.${p}.${s.slice(0, -4)}AAAA`), 401)
  })

  step('Widerruf wirkt sofort: PAT und OAuth-Zustimmung => 401 beim naechsten Aufruf', async () => {
    assert.equal(await toolsListStatus(patA.token), 200)
    assert.equal((await alice.request(`/api/me/pats/${patA.id}`, { method: 'DELETE' })).status, 204)
    assert.equal(await toolsListStatus(patA.token), 401)
    assert.equal(await toolsListStatus(oauth.access), 200)
    assert.equal((await alice.request(`/api/me/connections/${oauth.clientId}`, { method: 'DELETE' })).status, 204)
    assert.equal(await toolsListStatus(oauth.access), 401)
    const again = await refresh(base, { clientId: oauth.clientId, refreshToken: oauth.refresh })
    assert.ok(again.status >= 400, 'Refresh nach Widerruf muss scheitern')
    // Bobs Token war nie betroffen
    assert.equal(await toolsListStatus(patB.token), 200)
  })

  step('Nutzer sperren: Token sofort ungueltig, Entsperren stellt wieder her', async () => {
    const users = (await admin.request('/api/admin/users')).json.items as Array<{ id: string, email: string }>
    const bobId = users.find(u => u.email === 'bob@example.com')!.id
    assert.equal((await admin.request(`/api/admin/users/${bobId}/ban`, { body: { reason: 'smoke' } })).status, 204)
    assert.equal(await toolsListStatus(patB.token), 401)
    assert.equal((await admin.request(`/api/admin/users/${bobId}/unban`, { body: {} })).status, 204)
    assert.equal(await toolsListStatus(patB.token), 200)
  })

  return steps
}
