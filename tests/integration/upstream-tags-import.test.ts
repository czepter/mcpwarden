// Tags on upstreams and the mcpServers JSON import (dry run, secrets, collisions, stdio drafts, SSRF, limits).
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { UpstreamDetail, UpstreamImportResult, UpstreamList, UpstreamTagList } from '#shared/api-types'
import { createInstance, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

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

const imp = (json: unknown, dryRun = false) => admin.request('/api/upstreams/import', { body: { json: typeof json === 'string' ? json : JSON.stringify(json), dryRun } })
const list = async () => ((await admin.request('/api/upstreams')).json as UpstreamList).items

it('tags: normalised on create, patchable, returned in list and detail, distinct list endpoint, invalid ones rejected', async () => {
  const c = await admin.request('/api/upstreams', { body: { name: 'T', slug: 'tagged', type: 'http', url: 'https://tagged.example.com/mcp', tags: [' Prod ', 'prod', 'Team A'] } })
  expect(c.status).toBe(201)
  expect((c.json as UpstreamDetail).tags).toEqual(['prod', 'team a'])
  const id = (c.json as UpstreamDetail).id
  expect((await list()).find(u => u.id === id)?.tags).toEqual(['prod', 'team a'])

  const p = await admin.request(`/api/upstreams/${id}`, { method: 'PATCH', body: { tags: ['b', 'a'] } })
  expect((p.json as UpstreamDetail).tags).toEqual(['b', 'a'])
  // other patches keep tags
  expect(((await admin.request(`/api/upstreams/${id}`, { method: 'PATCH', body: { name: 'T2' } })).json as UpstreamDetail).tags).toEqual(['b', 'a'])
  expect(((await admin.request(`/api/upstreams/${id}`, { method: 'PATCH', body: { tags: [] } })).json as UpstreamDetail).tags).toEqual([])
  await admin.request(`/api/upstreams/${id}`, { method: 'PATCH', body: { tags: ['zeta', 'alpha'] } })

  expect(((await admin.request('/api/upstreams/tags')).json as UpstreamTagList).items).toEqual(['alpha', 'zeta'])
  for (const bad of [['x'.repeat(33)], Array.from({ length: 11 }, (_, i) => `t${i}`), 'prod', [1], ['<b>']]) {
    expect((await admin.request(`/api/upstreams/${id}`, { method: 'PATCH', body: { tags: bad } })).status).toBe(422)
  }
})

it('import: dry run writes nothing, the real run creates http upstreams with encrypted secrets that are never echoed', async () => {
  const doc = { mcpServers: {
    'Remote One': { url: 'https://one.example.com/mcp', headers: { Authorization: 'Bearer SECRET-TOKEN-1' } },
    'Keyed': { url: 'https://two.example.com/mcp', type: 'sse', headers: { 'X-Api-Key': 'SECRET-KEY-2', 'X-Extra': 'e' } },
    'Plain': { url: 'https://three.example.com/mcp' },
  } }
  const before = (await list()).length
  const dry = (await imp(doc, true)).json as UpstreamImportResult
  expect(dry).toMatchObject({ created: 3, skipped: 0 })
  expect(dry.items.map(i => i.status)).toEqual(['would_create', 'would_create', 'would_create'])
  expect((await list()).length).toBe(before)

  const r = await imp(doc)
  expect(r.status).toBe(200)
  const res = r.json as UpstreamImportResult
  expect(res).toMatchObject({ created: 3, skipped: 0 })
  expect(JSON.stringify(res)).not.toContain('SECRET')
  const items = await list()
  expect(items.length).toBe(before + 3)
  const one = items.find(u => u.slug === 'remote-one')!
  const keyed = items.find(u => u.slug === 'keyed')!
  expect(one).toMatchObject({ type: 'http', hasSecret: true, setup: 'ready', enabled: true })
  const keyedDetail = (await admin.request(`/api/upstreams/${keyed.id}`)).json as UpstreamDetail
  expect(keyedDetail).toMatchObject({ authType: 'header', authHeaderName: 'X-Api-Key', transport: 'sse', hasSecret: true })
  expect(JSON.stringify(keyedDetail)).not.toContain('SECRET')
  expect(res.items.find(i => i.slug === 'keyed')).toMatchObject({ notes: [expect.stringContaining('X-Extra')] })
  expect(items.find(u => u.slug === 'plain')).toMatchObject({ hasSecret: false, setup: 'ready' })
  // an audit entry per created upstream, no secret in it
  const audit = JSON.stringify((await admin.request('/api/audit')).json)
  expect(audit).toContain('remote-one')
  expect(audit).not.toContain('SECRET')
})

it('import: same name and target is skipped, same name with another target gets a suffixed slug', async () => {
  const r = (await imp({ mcpServers: { Plain: { url: 'https://three.example.com/mcp' }, 'plain ': { url: 'https://other.example.com/mcp' } } })).json as UpstreamImportResult
  expect(r.items[0]).toMatchObject({ status: 'skipped', reason: 'slug_taken' })
  expect(r.items[1]).toMatchObject({ status: 'created', slug: 'plain-2' })
})

it('import: SSRF-blocked and malformed entries are skipped one by one, the rest still imports', async () => {
  const r = (await imp({ mcpServers: { meta: { url: 'http://169.254.169.254/latest' }, bad: {}, weird: { url: 'https://x.example.com', type: 'pigeon' }, fine: { url: 'https://fine.example.com/mcp' } } })).json as UpstreamImportResult
  expect(r.items.map(i => (i.status === 'skipped' ? i.reason : i.status))).toEqual(['invalid', 'invalid', 'unsupported', 'created'])
  expect(r).toMatchObject({ created: 1, skipped: 3 })
})

it('import: stdio entries are skipped while stdio is not permitted; once allowed they arrive as DISABLED drafts with env values as encrypted secrets', async () => {
  const doc = { mcpServers: { files: { command: 'npx', args: ['-y', 'server-files'], env: { API_KEY: 'SECRET-ENV' } } } }
  expect((await admin.request('/api/admin/settings', { method: 'PUT', body: { 'stdio.enabled': false } })).status).toBe(200)
  expect(((await imp(doc)).json as UpstreamImportResult).items[0]).toMatchObject({ status: 'skipped', reason: 'stdio_not_allowed' })
  expect((await list()).some(u => u.slug === 'files')).toBe(false)

  const caps = (await admin.request('/api/me/capabilities')).json as { stdio: { allowed: boolean } }
  await admin.request('/api/admin/settings', { method: 'PUT', body: { 'stdio.enabled': true } })
  const capsAfter = (await admin.request('/api/me/capabilities')).json as { stdio: { allowed: boolean } }
  if (!capsAfter.stdio.allowed) { expect(caps.stdio.allowed).toBe(false); return } // image without stdio runtime: nothing more to prove here
  const res = (await imp(doc)).json as UpstreamImportResult
  expect(res.items[0]).toMatchObject({ status: 'created', type: 'stdio', slug: 'files' })
  expect(JSON.stringify(res)).not.toContain('SECRET')
  const d = (await admin.request(`/api/upstreams/${(res.items[0] as { id: string }).id}`)).json as UpstreamDetail
  expect(d).toMatchObject({ enabled: false, command: 'npx', args: ['-y', 'server-files'], authType: 'env', secretNames: ['API_KEY'] })
  expect(JSON.stringify(d)).not.toContain('SECRET')
})

it('import: whole-request errors are 422, requires a session', async () => {
  for (const bad of ['', '{nope', '{"mcpServers":{}}', '[]']) expect((await imp(bad)).status).toBe(422)
  expect((await admin.request('/api/upstreams/import', { body: {} })).status).toBe(422)
  const anon = await fetch(`${srv.url}/api/upstreams/import`, { method: 'POST', headers: { 'content-type': 'application/json', origin: srv.url }, body: '{}' })
  expect(anon.status).toBe(401)
})
