// Task 9 / A3: complete OAuth run against the built artifact (DCR -> authorize -> consent -> token ->
// /mcp) and immediate revocation. The frontend pages are still missing: authorize/consent are addressed via the
// API like the frontend does (redirect to /consent?<signed query>, consent-info, POST oauth2/consent with oauth_query).
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ConnectionList } from '#shared/api-types'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from '../harness'
import {
  authorizeAndConsent, authorizeUrl, decodeJwt, exchangeCode, fullFlow, getRaw, pkce, refresh, registerClient, revokeToken, REDIRECT,
} from '../../helpers/oauth-client'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient
let userB: ApiClient
let userBId: string
let mcpUrl: URL

const rpc = (body: unknown, token?: string, extra: Record<string, string> = {}) =>
  fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: JSON.stringify(body) })
const toolsList = (token?: string) => rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, token)
const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]!.text
const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

async function sdk(token: string) {
  const client = new Client({ name: 'oauth-test', version: '1' }, { versionNegotiation: { mode: 'auto' } })
  await client.connect(new StreamableHTTPClientTransport(mcpUrl, { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  return client
}

async function flowFor(user: ApiClient) {
  const f = await fullFlow(user, srv.url)
  expect(f.tok.status, f.tok.text).toBe(200)
  return { clientId: f.clientId, access: f.tok.json.access_token as string, refresh: f.tok.json.refresh_token as string }
}

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  mcpUrl = new URL(`${srv.url}/mcp`)
  admin = await signUpFirstAdmin(srv)
  userBId = (await createUser(admin, { name: 'B', email: 'b@example.com', password: 'password-b-12345' })).id
  userB = api(srv.url)
  expect((await userB.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'password-b-12345' } })).status).toBe(200)
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

describe('happy path, step by step (scenario 1)', () => {
  it('401 challenge -> protected resource -> AS metadata -> DCR -> authorize -> consent -> token -> tools/list -> tools/call', async () => {
    // 1. without token
    const challenge = await toolsList()
    expect(challenge.status).toBe(401)
    const www = challenge.headers.get('www-authenticate')!
    const prmUrl = /resource_metadata="([^"]+)"/.exec(www)![1]!
    expect(prmUrl).toBe(`${srv.url}/.well-known/oauth-protected-resource/mcp`)
    // 2. Protected Resource Metadata (RFC 9728)
    const prmRes = await fetch(prmUrl)
    expect(prmRes.headers.get('content-type')).toContain('application/json')
    expect(prmRes.headers.get('access-control-allow-origin')).toBe('*')
    const prm = await prmRes.json()
    expect(prm).toMatchObject({ resource: `${srv.url}/mcp`, authorization_servers: [`${srv.url}/api/auth`], bearer_methods_supported: ['header'] })
    expect(prm.scopes_supported).toContain('mcp:tools')
    // 3. AS metadata (RFC 8414, path insertion)
    const issuer = new URL(prm.authorization_servers[0])
    const as = await (await fetch(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`)).json()
    expect(as).toMatchObject({
      issuer: `${srv.url}/api/auth`, authorization_endpoint: `${srv.url}/api/auth/oauth2/authorize`, token_endpoint: `${srv.url}/api/auth/oauth2/token`,
      registration_endpoint: `${srv.url}/api/auth/oauth2/register`, jwks_uri: `${srv.url}/api/auth/jwks`, code_challenge_methods_supported: ['S256'],
    })
    // 4. DCR
    const reg = await registerClient(srv.url, { client_name: 'Claude Code' })
    expect(reg.status).toBe(201)
    const clientId = reg.json.client_id as string
    // 5. Authorize + consent (with login session, like the frontend)
    const { verifier, challenge: cc } = pkce()
    const r = await authorizeAndConsent(admin, srv.url, { clientId, challenge: cc, resource: prm.resource, state: 'xyz' })
    expect(r.step).toBe('done')
    if (r.step !== 'done') return
    expect(r.state).toBe('xyz')
    expect(r.iss).toBe(`${srv.url}/api/auth`)
    expect(r.redirect.origin + r.redirect.pathname).toBe(REDIRECT)
    // 6. Token
    const tok = await exchangeCode(srv.url, { clientId, code: r.code!, verifier, resource: prm.resource })
    expect(tok.status).toBe(200)
    expect(tok.json).toMatchObject({ token_type: 'Bearer', expires_in: 300 })
    const claims = decodeJwt(tok.json.access_token)
    expect(claims.aud).toContain(prm.resource)
    expect(claims.iss).toBe(`${srv.url}/api/auth`)
    expect(claims.scope).toBe('openid offline_access mcp:tools')
    // 7. /mcp
    const list = await toolsList(tok.json.access_token)
    expect(list.status).toBe(200)
    expect(await list.text()).toContain('dummy__echo')
    const c = await sdk(tok.json.access_token)
    expect(text(await c.callTool({ name: 'dummy__echo', arguments: { text: 'hallo' } }))).toBe('hallo')
    const who = JSON.parse(text(await c.callTool({ name: 'dummy__whoami', arguments: {} })))
    expect(who).toMatchObject({ role: 'admin', tokenType: 'oauth', scopes: ['openid', 'offline_access', 'mcp:tools'] })
    await c.close()
  })
  it('root well-known aliases resolve to the same documents', async () => {
    const a = await (await fetch(`${srv.url}/.well-known/oauth-authorization-server`)).json()
    const b = await (await fetch(`${srv.url}/.well-known/oauth-authorization-server/api/auth`)).json()
    expect(a).toEqual(b)
    const oidc = await fetch(`${srv.url}/.well-known/openid-configuration`)
    expect(oidc.status).toBe(200)
    const opts = await fetch(`${srv.url}/.well-known/oauth-protected-resource`, { method: 'OPTIONS' })
    expect(opts.status).toBe(204)
    expect(opts.headers.get('access-control-allow-origin')).toBe('*')
    expect((await fetch(`${srv.url}/.well-known/oauth-protected-resource`, { headers: { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' } }).then(r => r.json())).resource).toBe(`${srv.url}/mcp`)
  })
})

describe('protocol hardening (scenarios 2 to 4)', () => {
  it('PKCE is mandatory: no challenge or plain is refused, wrong verifier is invalid_grant', async () => {
    const reg = await registerClient(srv.url)
    const clientId = reg.json.client_id as string
    for (const p of [{ challenge: null }, { challenge: 'x'.repeat(43), challengeMethod: 'plain' }]) {
      const r = await authorizeAndConsent(admin, srv.url, { clientId, resource: `${srv.url}/mcp`, ...p })
      expect(r.step, JSON.stringify(p)).toBe('authorize')
    }
    const { challenge } = pkce()
    const ok = await authorizeAndConsent(admin, srv.url, { clientId, challenge, resource: `${srv.url}/mcp` })
    const bad = await exchangeCode(srv.url, { clientId, code: (ok as { code: string }).code, verifier: pkce().verifier })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('invalid_grant')
  })
  it('redirect_uri must match exactly (no redirect to the attacker URI)', async () => {
    const reg = await registerClient(srv.url)
    const url = authorizeUrl(srv.url, { clientId: reg.json.client_id, redirectUri: 'http://127.0.0.1:53124/other', challenge: pkce().challenge, resource: `${srv.url}/mcp` })
    const res = await getRaw(admin, url)
    expect(res.location ?? '').not.toContain('127.0.0.1:53124/other')
    expect(res.location ?? '').not.toContain('code=')
  })
  it('an authorization code works once', async () => {
    const reg = await registerClient(srv.url)
    const clientId = reg.json.client_id as string
    const { verifier, challenge } = pkce()
    const r = await authorizeAndConsent(admin, srv.url, { clientId, challenge, resource: `${srv.url}/mcp` })
    const code = (r as { code: string }).code
    expect((await exchangeCode(srv.url, { clientId, code, verifier, resource: `${srv.url}/mcp` })).status).toBe(200)
    const second = await exchangeCode(srv.url, { clientId, code, verifier, resource: `${srv.url}/mcp` })
    expect(second.status).toBe(400)
    expect(second.json.error).toBe('invalid_grant')
  })
})

describe('refresh and audience (scenarios 5 and 6)', () => {
  it('refresh rotates the pair; the new access token works; a retry inside the reuse window returns the same pair', async () => {
    const { clientId, access, refresh: rt } = await flowFor(admin)
    const r1 = await refresh(srv.url, { clientId, refreshToken: rt, resource: `${srv.url}/mcp` })
    expect(r1.status, r1.text).toBe(200)
    expect(r1.json.refresh_token).not.toBe(rt)
    expect(r1.json.access_token).not.toBe(access)
    expect((await toolsList(r1.json.access_token)).status).toBe(200)
    expect((await toolsList(access)).status).toBe(200) // old JWT lives until expiry as long as the user state is valid
    // Replaying the old refresh token within the window (30 s, mcp() default) returns the same response.
    const retry = await refresh(srv.url, { clientId, refreshToken: rt, resource: `${srv.url}/mcp` })
    expect(retry.status).toBe(200)
    expect(retry.json.refresh_token).toBe(r1.json.refresh_token)
    // A foreign client cannot redeem the token.
    const other = (await registerClient(srv.url)).json.client_id as string
    const stolen = await refresh(srv.url, { clientId: other, refreshToken: r1.json.refresh_token })
    expect(stolen.status).toBeGreaterThanOrEqual(400)
  })
  it('only tokens for this resource exist: a foreign resource is refused, a tampered audience fails the signature', async () => {
    const reg = await registerClient(srv.url)
    const r = await authorizeAndConsent(admin, srv.url, { clientId: reg.json.client_id, challenge: pkce().challenge, resource: `${srv.url}/other` })
    expect((r as { code?: string | null }).code ?? null).toBeNull() // no code for an unregistered resource
    const { access } = await flowFor(admin)
    const [h, p, s] = access.split('.') as [string, string, string]
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
    const forged = [h, Buffer.from(JSON.stringify({ ...claims, aud: 'http://elsewhere.example/mcp' })).toString('base64url'), s].join('.')
    expect((await toolsList(forged)).status).toBe(401)
    expect((await toolsList(`${h}.${p}.${s.slice(0, -4)}AAAA`)).status).toBe(401)
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${p}.`
    expect((await toolsList(none)).status).toBe(401)
  })
})

describe('instant revocation (scenario 7): the still valid JWT is refused on the very next request', () => {
  it('(a) consent revoked via /api/me/connections; connection list shows lastUsedAt and active first', async () => {
    const { clientId, access } = await flowFor(userB)
    const before = ((await userB.request('/api/me/connections')).json as ConnectionList).items.find(i => i.clientId === clientId)!
    expect(before).toMatchObject({ lastUsedAt: null, active: false, name: 'Claude Code (test)', redirectHost: '127.0.0.1:53124', scopes: expect.arrayContaining(['mcp:tools']) })
    expect((await toolsList(access)).status).toBe(200)
    await vi.waitFor(async () => {
      const c = ((await userB.request('/api/me/connections')).json as ConnectionList).items.find(i => i.clientId === clientId)!
      expect(c.active).toBe(true)
      expect(Math.abs(Date.now() - Date.parse(c.lastUsedAt!))).toBeLessThan(60_000)
    })
    expect((await userB.request(`/api/me/connections/${clientId}`, { method: 'DELETE' })).status).toBe(204)
    expect((await toolsList(access)).status).toBe(401)
    expect((await userB.request(`/api/me/connections/${clientId}`, { method: 'DELETE' })).status).toBe(404)
    expect(((await userB.request('/api/me/connections')).json as ConnectionList).items.some(i => i.clientId === clientId)).toBe(false)
  })
  it('(b) client disabled by the admin, (b2) client deleted', async () => {
    const f = await flowFor(userB)
    expect((await toolsList(f.access)).status).toBe(200)
    expect((await admin.request(`/api/admin/oauth/clients/${f.clientId}`, { method: 'PATCH', body: { disabled: true } })).status).toBe(200)
    expect((await toolsList(f.access)).status).toBe(401)
    expect((await admin.request(`/api/admin/oauth/clients/${f.clientId}`, { method: 'PATCH', body: { disabled: false } })).status).toBe(200)
    expect((await toolsList(f.access)).status).toBe(200)
    expect((await admin.request(`/api/admin/oauth/clients/${f.clientId}`, { method: 'DELETE' })).status).toBe(204)
    expect((await toolsList(f.access)).status).toBe(401)
  })
  it('(d)(e) only the refresh token revoked (RFC 7009), consent stays: 401 at once and no further refresh', async () => {
    const f = await flowFor(userB)
    expect((await toolsList(f.access)).status).toBe(200)
    const rev = await revokeToken(srv.url, { clientId: f.clientId, token: f.refresh, hint: 'refresh_token' })
    expect(rev.status).toBe(200)
    const consents = ((await userB.request('/api/me/connections')).json as ConnectionList).items.filter(i => i.clientId === f.clientId)
    expect(consents).toHaveLength(1) // consent persists
    expect((await toolsList(f.access)).status).toBe(401)
    const again = await refresh(srv.url, { clientId: f.clientId, refreshToken: f.refresh })
    expect(again.status).toBeGreaterThanOrEqual(400)
  })
  it('(c)(f) user banned: OAuth token and PAT are refused at once and stay revoked after unban (review M-B); new credentials work', async () => {
    const f = await flowFor(userB)
    const pat = (await userB.request('/api/me/pats', { body: { name: 'ban-test' } })).json.token as string
    expect((await toolsList(f.access)).status).toBe(200)
    expect((await toolsList(pat)).status).toBe(200)
    expect((await admin.request(`/api/admin/users/${userBId}/ban`, { body: { reason: 'test' } })).status).toBe(204)
    expect((await toolsList(f.access)).status).toBe(401)
    expect((await toolsList(pat)).status).toBe(401)
    expect((await admin.request(`/api/admin/users/${userBId}/unban`, { body: {} })).status).toBe(204)
    // Unbanning does not revive old credentials (spec P0-4: banning ends OAuth tokens and PATs)
    expect((await toolsList(f.access)).status).toBe(401)
    expect((await toolsList(pat)).status).toBe(401)
    expect((await refresh(srv.url, { clientId: f.clientId, refreshToken: f.refresh })).status).toBeGreaterThanOrEqual(400)
    // Rebuild the session of user B after the ban
    userB = api(srv.url)
    expect((await userB.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'password-b-12345' } })).status).toBe(200)
    const pats = (await userB.request('/api/me/pats')).json as { items: Array<{ name: string, revokedAt: string | null }> }
    expect(pats.items.find(p => p.name === 'ban-test')?.revokedAt).not.toBeNull()
    expect(((await userB.request('/api/me/connections')).json as ConnectionList).items.filter(i => i.clientId === f.clientId)).toHaveLength(0)
    // new credentials work
    const fresh = await userB.request('/api/me/pats', { body: { name: 'after-unban' } })
    expect((await toolsList(fresh.json.token as string)).status).toBe(200)
    expect((await toolsList((await flowFor(userB)).access)).status).toBe(200)
  })
})

describe('tenancy with OAuth tokens (scenario A9)', () => {
  it('list_changed reaches only the user who toggled; whoami is per user', async () => {
    const a = await flowFor(admin)
    const b = await flowFor(userB)
    const ca = await sdk(a.access)
    const cb = await sdk(b.access)
    const gotA = vi.fn()
    const gotB = vi.fn()
    ca.setNotificationHandler('notifications/tools/list_changed', gotA)
    cb.setNotificationHandler('notifications/tools/list_changed', gotB)
    const subA = await ca.listen({ toolsListChanged: true })
    const subB = await cb.listen({ toolsListChanged: true })
    await ca.callTool({ name: 'dummy__toggle_tool', arguments: {} })
    await vi.waitFor(() => expect(gotA).toHaveBeenCalledTimes(1))
    await tick(300)
    expect(gotB).not.toHaveBeenCalled()
    expect(JSON.parse(text(await ca.callTool({ name: 'dummy__whoami', arguments: {} }))).userId).not.toBe(JSON.parse(text(await cb.callTool({ name: 'dummy__whoami', arguments: {} }))).userId)
    expect((await cb.listTools()).tools.map(t => t.name)).toContain('dummy__echo')
    await ca.callTool({ name: 'dummy__toggle_tool', arguments: {} })
    await subA.close(); await subB.close()
    await Promise.all([ca.close(), cb.close()])
  })
  it('revoking a client closes the open listen stream of that user', async () => {
    const f = await flowFor(userB)
    const c = await sdk(f.access)
    const sub = await c.listen({ toolsListChanged: true })
    await userB.request(`/api/me/connections/${f.clientId}`, { method: 'DELETE' })
    expect(await Promise.race([sub.closed, tick(3000).then(() => 'timeout')])).not.toBe('timeout')
    await c.close().catch(() => {})
  })
})
