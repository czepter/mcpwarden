import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AuditList, Capabilities, ConnectionList, Dashboard, PatList, UpstreamList } from '#shared/api-types'
import { makeServer } from '../../../mocks/node'
import { getState, resetState } from '../../../mocks/state'

// Je Route ein zod-Schema; `satisfies` haelt es mit dem Vertragstyp zusammen. Gegen den echten Server mit CONTRACT_BASE_URL + COOKIE.
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3000'
const iso = z.string()
const upstream = z.object({ id: z.string(), slug: z.string(), name: z.string(), type: z.enum(['http', 'stdio', 'rest']), status: z.string(), setup: z.string(), toolsEnabled: z.number(), toolsTotal: z.number(), hasSecret: z.boolean(), rateLimitHits5m: z.number() }).passthrough()
const schemas = {
  upstreams: z.object({ items: z.array(upstream) }) satisfies z.ZodType<Pick<UpstreamList, never> & { items: unknown[] }>,
  pats: z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), prefix: z.string(), createdAt: iso, lastUsedAt: iso.nullable(), revokedAt: iso.nullable() })), limit: z.object({ max: z.number(), active: z.number() }) }) satisfies z.ZodType<PatList>,
  connections: z.object({ items: z.array(z.object({ clientId: z.string(), name: z.string(), scopes: z.array(z.string()), redirectHost: z.string(), allowlisted: z.boolean(), grantedAt: iso, lastUsedAt: iso.nullable(), active: z.boolean() })) }) satisfies z.ZodType<ConnectionList>,
  caps: z.object({ mcpUrl: z.string(), role: z.enum(['admin', 'user']), stdio: z.object({ allowed: z.boolean(), reason: z.string().optional() }), limits: z.object({ maxUpstreams: z.number(), upstreamsUsed: z.number(), maxConnections: z.number(), callsPerMin: z.number() }), defaults: z.object({ ratePerMin: z.number(), maxConcurrent: z.number(), timeouts: z.object({ connectMs: z.number(), listMs: z.number(), callMs: z.number() }) }) }).passthrough() satisfies z.ZodType<Omit<Capabilities, 'stdio' | 'features'> & { stdio: unknown }>,
  dashboard: z.object({ clients: z.array(z.object({ kind: z.enum(['oauth', 'pat']), id: z.string(), name: z.string(), active: z.boolean() }).passthrough()), attention: z.array(z.object({ upstreamId: z.string(), name: z.string(), status: z.string() }).passthrough()), attentionCount: z.number() }) satisfies z.ZodType<Omit<Dashboard, 'clients' | 'attention'> & { clients: unknown[], attention: unknown[] }>,
  audit: z.object({ items: z.array(z.object({ id: z.string(), ts: iso, action: z.string(), category: z.string(), scope: z.enum(['user', 'instance']), result: z.string() }).passthrough()), nextCursor: z.string().nullable() }) satisfies z.ZodType<Omit<AuditList, 'items'> & { items: unknown[] }>,
}
const server = makeServer('all')
beforeAll(() => { (globalThis as { __mockNoDelay?: boolean }).__mockNoDelay = true; server.listen({ onUnhandledFrame: 'error' }) })
afterAll(() => server.close())
beforeEach(() => { resetState(); getState().signedIn = true })

async function call(path: string, init?: RequestInit) { return fetch(`${BASE}${path}`, init) }

describe('Mock-Antworten bestehen die Vertrags-Schemas', () => {
  for (const [name, path, key] of [['upstreams', '/api/upstreams', 'upstreams'], ['pats', '/api/me/pats', 'pats'], ['connections', '/api/me/connections', 'connections'], ['capabilities', '/api/me/capabilities', 'caps'], ['dashboard', '/api/dashboard', 'dashboard'], ['audit', '/api/audit', 'audit']] as const) {
    it(name, async () => { const r = await call(path); expect(r.status).toBe(200); schemas[key].parse(await r.json()) })
  }
  it('Fehlerform ist ApiErrorBody', async () => {
    const r = await call('/api/upstreams/gibtsnicht')
    expect(r.status).toBe(404)
    z.object({ statusCode: z.number(), statusMessage: z.string(), data: z.object({ code: z.string(), message: z.string() }) }).parse(await r.json())
  })
})

describe('Mock-Regeln wie das Backend', () => {
  const post = (p: string, b: unknown) => call(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  it('Slug-Regex und 409 bei Kollision', async () => {
    expect((await post('/api/upstreams', { name: 'x', slug: 'Bad_Slug', type: 'http', url: 'https://a.example' })).status).toBe(422)
    expect((await post('/api/upstreams', { name: 'x', slug: 'github', type: 'http', url: 'https://a.example' })).status).toBe(409)
  })
  it('PAT-Klartext nur in der POST-Antwort, nie im Zustand oder in der Liste', async () => {
    const created = await (await post('/api/me/pats', { name: 'canary' })).json() as { token: string }
    expect(created.token).toMatch(/^mcpw_pat_/)
    expect(JSON.stringify(await (await call('/api/me/pats')).json())).not.toContain(created.token)
    expect(JSON.stringify(getState())).not.toContain(created.token)
  })
  it('Secret wird nie gespeichert', async () => {
    const canary = 'CANARY-secret-value-12345'
    await call('/api/upstreams/up_1/secret', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'bearer', value: canary }) })
    expect(JSON.stringify(getState())).not.toContain(canary)
    expect(JSON.stringify(await (await call('/api/upstreams/up_1')).json())).not.toContain(canary)
  })
  it('Seed enthaelt kein Secret', () => {
    const s = JSON.stringify(getState())
    expect(s).not.toMatch(/mcpw_pat_[A-Za-z0-9]{20,}/)
    expect(s).not.toMatch(/Bearer\s+\w{10,}/)
  })
  it('ohne Sitzung 401', async () => {
    getState().signedIn = false
    expect((await call('/api/upstreams')).status).toBe(401)
  })
})
