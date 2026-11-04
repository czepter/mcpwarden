// Aufgabe 4: consent-info (Datenform, Allowlist-Status, Signatur) und Consent-Verhalten des Plugins.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConsentInfo } from '#shared/api-types'
import { api, createInstance, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from '../harness'
import { authorizeAndConsent, decodeJwt, exchangeCode, pkce, registerClient, REDIRECT } from '../../helpers/oauth-client'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  admin = await signUpFirstAdmin(srv)
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

async function begin(meta: Parameters<typeof registerClient>[1] = {}, p: { scope?: string | null, consentScope?: string, accept?: boolean, resource?: string | null, redirectUri?: string } = {}) {
  const reg = await registerClient(srv.url, meta)
  const clientId = reg.json.client_id as string
  const { verifier, challenge } = pkce()
  const r = await authorizeAndConsent(admin, srv.url, { clientId, challenge, resource: p.resource === undefined ? `${srv.url}/mcp` : p.resource, scope: p.scope, consentScope: p.consentScope, accept: p.accept, redirectUri: p.redirectUri })
  return { clientId, verifier, r }
}

describe('consent-info', () => {
  it('known client (name and redirect on the allowlist) is allowlisted', async () => {
    const { r } = await begin({ client_name: 'Claude Code (x)' })
    expect(r.step).toBe('done')
    const info = (r as { info: { status: number, json: ConsentInfo } }).info
    expect(info.status).toBe(200)
    const j = info.json satisfies ConsentInfo
    expect(Object.keys(j).sort()).toEqual(['client', 'loopback', 'resource', 'scopes'])
    expect(Object.keys(j.client).sort()).toEqual(['allowlisted', 'id', 'name', 'redirects', 'registeredAt', 'viaDcr'])
    expect(j.client).toMatchObject({ name: 'Claude Code (x)', allowlisted: true, viaDcr: true })
    expect(Number.isNaN(Date.parse(j.client.registeredAt))).toBe(false)
    expect(j.client.redirects).toEqual([{ uri: REDIRECT, host: '127.0.0.1:53124', kind: 'loopback', loopback: true }])
    expect(j.loopback).toBe(true)
    expect(j.resource).toBe(`${srv.url}/mcp`)
    expect(j.scopes).toEqual([{ name: 'openid', required: true }, { name: 'offline_access', required: true }, { name: 'mcp:tools', required: true }])
    expect(JSON.stringify(j)).not.toContain('mcpwarden:admin')
  })
  it('unknown client is not allowlisted; app and web redirects are classified', async () => {
    const { r } = await begin({ client_name: 'Mystery Tool', redirect_uris: ['https://tool.example/cb', 'cursor://x/y'] }, { redirectUri: 'https://tool.example/cb' })
    const j = (r as { info: { json: ConsentInfo } }).info.json
    expect(j.client.allowlisted).toBe(false)
    expect(j.client.redirects.map(x => x.kind)).toEqual(['web', 'app'])
    expect(j.loopback).toBe(false)
  })
  it('long and control-character names are sanitized', async () => {
    const { r } = await begin({ client_name: `Evil\u0007${'x'.repeat(200)}` })
    const name = (r as { info: { json: ConsentInfo } }).info.json.client.name
    expect(name.length).toBeLessThanOrEqual(80)
    expect(name).not.toContain('\u0007')
  })
  it('rejects a tampered or missing query (400) and anonymous callers (401)', async () => {
    const { r } = await begin()
    const q = (r as { oauthQuery: string }).oauthQuery
    const bad = await admin.request(`/api/oauth/consent-info?${q.replace('client_id=', 'client_id=x')}`)
    expect(bad.status).toBe(400)
    expect(bad.json.data.code).toBe('invalid_consent_query')
    expect((await admin.request('/api/oauth/consent-info')).status).toBe(400)
    expect((await api(srv.url).request(`/api/oauth/consent-info?${q}`)).status).toBe(401)
  })
  it('404 client_not_found when the client vanished after authorize', async () => {
    const { clientId, r } = await begin()
    await admin.request(`/api/admin/oauth/clients/${clientId}`, { method: 'DELETE' })
    const res = await admin.request(`/api/oauth/consent-info?${(r as { oauthQuery: string }).oauthQuery}`)
    expect(res.status).toBe(404)
    expect(res.json.data.code).toBe('client_not_found')
  })
})

describe('consent decisions and mandatory scopes', () => {
  it('a client requesting only mcp:tools still gets offline_access (refresh token) and openid', async () => {
    const { clientId, verifier, r } = await begin({}, { scope: 'mcp:tools' })
    expect(r.step).toBe('done')
    const tok = await exchangeCode(srv.url, { clientId, code: (r as { code: string }).code, verifier, resource: `${srv.url}/mcp` })
    expect(tok.status).toBe(200)
    expect(tok.json.refresh_token).toBeTruthy()
    expect(tok.json.scope.split(' ').sort()).toEqual(['mcp:tools', 'offline_access', 'openid'])
  })
  it('a request without resource is bound to the default resource (JWT with aud)', async () => {
    const { clientId, verifier, r } = await begin({}, { resource: null })
    const tok = await exchangeCode(srv.url, { clientId, code: (r as { code: string }).code, verifier })
    const claims = decodeJwt(tok.json.access_token)
    expect(claims.aud).toContain(`${srv.url}/mcp`)
    expect(claims.iss).toBe(`${srv.url}/api/auth`)
    expect(claims.azp).toBe(clientId)
  })
  it('a subset without a mandatory scope is rejected (400), the full set passes', async () => {
    for (const consentScope of ['openid', 'mcp:tools', 'openid mcp:tools', 'mcp:tools openid offline_access mcpwarden:admin']) {
      const { r } = await begin({}, { consentScope })
      expect(r.step, consentScope).toBe('consent')
      expect((r as { consent: { status: number } }).consent.status, consentScope).toBe(400)
    }
    const ok = await begin({}, { consentScope: 'openid offline_access mcp:tools' })
    expect(ok.r.step).toBe('done')
  })
  it('deny redirects with error=access_denied and issues no code', async () => {
    const { r } = await begin({}, { accept: false })
    expect(r.step).toBe('done')
    expect((r as { error: string | null }).error).toBe('access_denied')
    expect((r as { code: string | null }).code).toBeNull()
  })
})
