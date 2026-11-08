import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { schemas } from '../../contract/schemas'
import { makeServer } from '../../../mocks/node'
import { getState, resetState } from '../../../mocks/state'

// Per route a zod schema from tests/contract/schemas.ts (strict, `satisfies` on the contract type); the same schemas check
// the real backend responses in tests/integration/contract.test.ts. Against a real server with CONTRACT_BASE_URL + COOKIE.
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3000'
const server = makeServer('all')
beforeAll(() => { (globalThis as { __mockNoDelay?: boolean }).__mockNoDelay = true; server.listen({ onUnhandledFrame: 'error' }) })
afterAll(() => server.close())
beforeEach(() => { resetState(); getState().signedIn = true })

async function call(path: string, init?: RequestInit) { return fetch(`${BASE}${path}`, init) }

describe('Mock responses pass the contract schemas', () => {
  for (const [name, path, key] of [['upstreams', '/api/upstreams', 'upstreamList'], ['pats', '/api/me/pats', 'pats'], ['connections', '/api/me/connections', 'connections'], ['capabilities', '/api/me/capabilities', 'capabilities'], ['dashboard', '/api/dashboard', 'dashboard'], ['audit', '/api/audit', 'audit']] as const) {
    it(name, async () => { const r = await call(path); expect(r.status).toBe(200); schemas[key].parse(await r.json()) })
  }
  it('Error shape is ApiErrorBody', async () => {
    const r = await call('/api/upstreams/gibtsnicht')
    expect(r.status).toBe(404)
    z.object({ statusCode: z.number(), statusMessage: z.string(), data: z.object({ code: z.string(), message: z.string() }) }).parse(await r.json())
  })
})

describe('Mock rules like the backend', () => {
  const post = (p: string, b: unknown) => call(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  it('Slug regex and 409 on collision', async () => {
    expect((await post('/api/upstreams', { name: 'x', slug: 'Bad_Slug', type: 'http', url: 'https://a.example' })).status).toBe(422)
    expect((await post('/api/upstreams', { name: 'x', slug: 'github', type: 'http', url: 'https://a.example' })).status).toBe(409)
  })
  it('Dashboard: upstreams with a pending setup appear in the attention list, with setup and reason (P0-16)', async () => {
    const created = await (await post('/api/upstreams', { name: 'Waiting', slug: 'waiting', type: 'http', url: 'https://w.example/mcp', authType: 'bearer' })).json() as { id: string }
    const dash = schemas.dashboard.parse(await (await call('/api/dashboard')).json())
    const a = dash.attention.find(x => x.upstreamId === created.id)
    expect(a).toMatchObject({ setup: 'awaiting_auth', slug: 'waiting' })
    expect(a?.statusReason).toBeTruthy()
    expect(dash.attentionCount).toBe(dash.attention.length)
    // healthy, ready upstreams of the seed stay out
    expect(dash.attention.every(x => x.setup !== 'ready' || ['degraded', 'open', 'auth_expired'].includes(x.status))).toBe(true)
  })
  it('Capabilities: stdio block reasons for the approval checklist stay inside the contract', async () => {
    expect(schemas.capabilities.parse(await (await call('/api/me/capabilities')).json()).stdio).toEqual({ allowed: true })
    getState().settings['stdio.enabled'] = false
    expect(schemas.capabilities.parse(await (await call('/api/me/capabilities')).json()).stdio).toEqual({ allowed: false, reason: 'instance_disabled' })
  })
  it('PAT plaintext only in the POST response, never in the state or in the list', async () => {
    const created = await (await post('/api/me/pats', { name: 'canary' })).json() as { token: string }
    expect(created.token).toMatch(/^mcpw_pat_/)
    expect(JSON.stringify(await (await call('/api/me/pats')).json())).not.toContain(created.token)
    expect(JSON.stringify(getState())).not.toContain(created.token)
  })
  it('Secret is never stored', async () => {
    const canary = 'CANARY-secret-value-12345'
    await call('/api/upstreams/up_1/secret', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'bearer', value: canary }) })
    expect(JSON.stringify(getState())).not.toContain(canary)
    expect(JSON.stringify(await (await call('/api/upstreams/up_1')).json())).not.toContain(canary)
  })
  it('Seed contains no secret', () => {
    const s = JSON.stringify(getState())
    expect(s).not.toMatch(/mcpw_pat_[A-Za-z0-9]{20,}/)
    expect(s).not.toMatch(/Bearer\s+\w{10,}/)
  })
  it('401 without a session', async () => {
    getState().signedIn = false
    expect((await call('/api/upstreams')).status).toBe(401)
  })
})

describe('REST upstreams (mock rules like the backend)', () => {
  const send = (method: string, p: string, b: unknown) => call(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  const tool = { name: 'get_item', urlTemplate: '/items/{id}', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
  it('seed has a REST upstream with three tools in the detail, none in the list summary', async () => {
    const d = await (await call('/api/upstreams/up_6')).json() as { type: string, restTools: unknown[] }
    expect(d.type).toBe('rest'); expect(d.restTools).toHaveLength(3)
    const list = await (await call('/api/upstreams')).json() as { items: Array<Record<string, unknown>> }
    expect(list.items.find(u => u.slug === 'local')).not.toHaveProperty('restTools')
  })
  it('create validates the tools like the server (placeholder without parameter, relative path without base URL)', async () => {
    const bad = await send('POST', '/api/upstreams', { name: 'R', slug: 'r1', type: 'rest', url: 'https://api.example.com', restTools: [{ name: 'a', urlTemplate: '/x/{nope}' }] })
    expect(bad.status).toBe(422)
    const noBase = await send('POST', '/api/upstreams', { name: 'R', slug: 'r2', type: 'rest', restTools: [tool] })
    expect(noBase.status).toBe(422)
    const hostInj = await send('POST', '/api/upstreams', { name: 'R', slug: 'r3', type: 'rest', restTools: [{ ...tool, urlTemplate: 'https://{id}/x' }] })
    expect(hostInj.status).toBe(422)
  })
  it('create, read, replace tools; counts follow; oauth is refused', async () => {
    const created = await send('POST', '/api/upstreams', { name: 'R', slug: 'r4', type: 'rest', url: 'https://api.example.com/v1', restTools: [tool] })
    expect(created.status).toBe(201)
    const u = await created.json() as { id: string, toolsTotal: number, restTools: Array<{ name: string }> }
    expect(u.toolsTotal).toBe(1); expect(u.restTools[0]!.name).toBe('get_item')
    const put = await send('PUT', `/api/upstreams/${u.id}/rest-tools`, { items: [tool, { name: 'ping', urlTemplate: '/ping' }] })
    expect(put.status).toBe(200)
    const listed = await (await call(`/api/upstreams/${u.id}/rest-tools`)).json()
    expect(schemas.restToolList.safeParse(listed).success).toBe(true)
    expect((listed as { items: unknown[] }).items).toHaveLength(2)
    expect(schemas.upstreamDetail.safeParse(await (await call(`/api/upstreams/${u.id}`)).json()).success).toBe(true)
    expect(((await (await call(`/api/upstreams/${u.id}`)).json()) as { toolsTotal: number }).toolsTotal).toBe(2)
    expect((await send('POST', '/api/upstreams', { name: 'R', slug: 'r5', type: 'rest', url: 'https://api.example.com', authType: 'oauth' })).status).toBe(422)
  })
  it('only REST upstreams have REST tools', async () => {
    expect((await call('/api/upstreams/up_1/rest-tools')).status).toBe(422)
  })
})
