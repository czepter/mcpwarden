import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LinkInfo, StdioDraft } from '#shared/api-types'
import { schemas as baseSchemas } from '../../contract/schemas'
import { makeServer } from '../../../mocks/node'
import { getState, resetState } from '../../../mocks/state'

// Strict schemas (strictObject): missing AND unknown fields in mock responses stand out.
// `satisfies z.ZodType<T>` binds each schema to the contract type in shared/api-types.ts; backend tests can use the same schemas.
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3000'
const { string: str } = z

// Phase 2 routes (auth links, stdio draft): there is no backend, only the mocks; the other schemas come from tests/contract/schemas.ts.
const phase2 = {
  draft: z.strictObject({ id: str(), slug: str(), command: str(), args: z.array(str()), cwd: str(), envNames: z.array(str()), createdVia: z.strictObject({ client: str(), at: str() }) }) satisfies z.ZodType<StdioDraft>,
  link: z.union([
    z.strictObject({ state: z.literal('open'), kind: z.enum(['token', 'header', 'oauth']), upstream: z.strictObject({ slug: str(), url: str() }), headerName: str().optional(), expiresAt: str() }),
    z.strictObject({ state: z.enum(['expired', 'used', 'forbidden']) }),
  ]) satisfies z.ZodType<LinkInfo>,
}
const schemas = { ...baseSchemas, ...phase2 }

const server = makeServer('all')
beforeAll(() => { (globalThis as { __mockNoDelay?: boolean }).__mockNoDelay = true; server.listen({ onUnhandledFrame: 'error' }) })
afterAll(() => server.close())
beforeEach(() => { resetState(); getState().signedIn = true })

const get = (path: string) => fetch(`${BASE}${path}`)
const post = (path: string, body?: unknown) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

describe('all GET routes: strict contract schemas', () => {
  const cases: Array<[string, string, keyof typeof schemas]> = [
    ['Session', '/api/auth/get-session', 'session'],
    ['Upstream list', '/api/upstreams', 'upstreamList'],
    ['Upstream-Detail', '/api/upstreams/up_1', 'upstreamDetail'],
    ['Tools', '/api/upstreams/up_1/tools', 'tools'],
    ['stdio draft', '/api/upstreams/up_1/draft', 'draft'],
    ['Tokens', '/api/me/pats', 'pats'],
    ['Connections', '/api/me/connections', 'connections'],
    ['Users', '/api/admin/users', 'users'],
    ['Invitations', '/api/admin/invites', 'invites'],
    ['Invitation valid', '/api/invites/valid-token', 'inviteCheck'],
    ['Invitation expired', '/api/invites/expired-token', 'inviteCheck'],
    ['Instance settings', '/api/admin/settings', 'settings'],
    ['DCR-Richtlinie', '/api/admin/oauth/policy', 'policy'],
    ['Allowlist', '/api/admin/oauth/allowlist', 'allowlist'],
    ['OAuth-Clients', '/api/admin/oauth/clients', 'oauthClients'],
    ['Consent (unknown)', '/api/oauth/consent-info?client_id=agent-x&sig=ok', 'consent'],
    ['Consent (known)', '/api/oauth/consent-info?client_id=claude-code&sig=ok', 'consent'],
    ['Statistics', '/api/stats/summary?window=24h', 'stats'],
    ['Statistics, one upstream and tool', '/api/stats/summary?window=7d&upstream=github&tool=get_item', 'stats'],
    ['Upstream statistics', '/api/upstreams/up_1/stats?window=24h', 'upstreamStats'],
    ['Health history', '/api/upstreams/up_1/health-history', 'healthHistory'],
    ['Admin statistics', '/api/admin/stats?window=24h', 'adminStats'],
    ['Link open', '/api/links/abc', 'link'],
    ['Link expired', '/api/links/expired', 'link'],
    ['Audit', '/api/audit', 'audit'],
    ['Public-Config', '/api/public-config', 'publicConfig'],
    ['Capabilities', '/api/me/capabilities', 'capabilities'],
    ['Dashboard', '/api/dashboard', 'dashboard'],
    ['Personal settings', '/api/me/settings', 'meSettings'],
  ]
  for (const [name, path, key] of cases) {
    it(name, async () => {
      const r = await get(path)
      expect(r.status).toBe(200)
      const res = schemas[key].safeParse(await r.json())
      expect(res.success ? [] : res.error.issues, `${path}`).toEqual([])
    })
  }
  it('Test response (ok and error)', async () => {
    const ok = await post('/api/upstreams/up_1/test')
    expect(schemas.testResult.safeParse(await ok.json()).success).toBe(true)
  })
})

describe('Mail notifications: setting and invitation sending', () => {
  const patch = (path: string, body: unknown) => fetch(`${BASE}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  it('Default on; PATCH toggles and persists; response matches the contract', async () => {
    expect(await (await get('/api/me/settings')).json()).toEqual({ notifyStatusMail: true })
    const r = await patch('/api/me/settings', { notifyStatusMail: false })
    expect(r.status).toBe(200)
    expect(schemas.meSettings.parse(await r.json())).toEqual({ notifyStatusMail: false })
    expect(await (await get('/api/me/settings')).json()).toEqual({ notifyStatusMail: false })
  })
  it('PATCH validates like the backend: non-boolean and unknown fields are 422', async () => {
    const bad = await patch('/api/me/settings', { notifyStatusMail: 'no' })
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { data: { field?: string } }).data.field).toBe('notifyStatusMail')
    expect((await patch('/api/me/settings', { role: 'admin' })).status).toBe(422)
  })
  it('Invitation with sendMail: mailQueued; without an address or without a mailer 422', async () => {
    const ok = await post('/api/admin/invites', { email: 'new@example.test', sendMail: true })
    expect(ok.status).toBe(201)
    expect(schemas.inviteCreated.parse(await ok.json()).mailQueued).toBe(true)
    const noAddr = await post('/api/admin/invites', { sendMail: true })
    expect(noAddr.status).toBe(422)
    expect(((await noAddr.json()) as { data: { field?: string } }).data.field).toBe('sendMail')
    localStorage.setItem('mockMail', 'off')
    try { expect((await post('/api/admin/invites', { email: 'new@example.test', sendMail: true })).status).toBe(422) } finally { localStorage.removeItem('mockMail') }
  })
})

describe('Errors and roles like the backend', () => {
  it('Admin routes: user gets 403 with ApiErrorBody', async () => {
    localStorage.setItem('mockRole', 'user')
    for (const p of ['/api/admin/users', '/api/admin/invites', '/api/admin/settings', '/api/admin/oauth/policy', '/api/admin/oauth/clients']) {
      const r = await get(p)
      expect(r.status, p).toBe(403)
      z.strictObject({ statusCode: z.literal(403), statusMessage: str(), data: z.looseObject({ code: z.literal('forbidden'), message: str() }) }).parse(await r.json())
    }
  })
  it('Registration: password under 12 characters is rejected server-side', async () => {
    const r = await fetch(`${BASE}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-invite-token': 'valid-token' }, body: JSON.stringify({ name: 'N', email: 'n@example.test', password: 'kurz' }) })
    expect(r.status).toBe(422)
    expect(((await r.json()) as { data: { field?: string } }).data.field).toBe('password')
  })
})
