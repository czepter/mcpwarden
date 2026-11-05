// Graceful shutdown: SIGTERM during a running call -> /readyz immediately 503 (draining), the call ends regularly,
// measurement data is written, the process exits with 0; afterwards the restart delivers the data.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { PatCreated, UpstreamDetail } from '#shared/api-types'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { createInstance, signUpFirstAdmin, startServer, type TestInstance } from './harness'

let inst: TestInstance
let fake: FakeHttp
beforeAll(async () => { inst = await createInstance(); fake = await startFakeHttp() })
afterAll(async () => { await fake.close(); await inst.cleanup() })

it('drains: in-flight call completes, readyz is 503 meanwhile, exit code 0, stats are persisted', async () => {
  const srv = await startServer(inst)
  const admin = await signUpFirstAdmin(srv)
  await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })
  const up = (await admin.request('/api/upstreams', { body: { name: 'F', slug: 'f', type: 'http', url: fake.url } })).json as UpstreamDetail
  const pat = (await admin.request('/api/me/pats', { body: { name: 'p' } })).json as PatCreated
  const c = new Client({ name: 't', version: '1' })
  await c.connect(new StreamableHTTPClientTransport(new URL(`${srv.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${pat.token}` } } }))
  await c.listTools()
  fake.state.slowMs = 2000
  const call = c.callTool({ name: 'f__echo', arguments: { text: 'slow' } })
  await new Promise(r => setTimeout(r, 500))
  srv.proc.kill('SIGTERM')
  await new Promise(r => setTimeout(r, 300))
  const ready = await fetch(`${srv.url}/readyz`).then(r => ({ status: r.status })).catch(() => ({ status: 0 }))
  expect([503, 0]).toContain(ready.status) // 503 draining, or already exited
  const res = await call
  expect((res.content as Array<{ text: string }>)[0]!.text).toBe('slow')
  expect(await srv.exited).toBe(0)
  expect(srv.logs()).toContain('shutdown: db closed')

  // Restart: upstream and measurement data (call_stat) are there
  const again = await startServer(inst)
  try {
    const login = await fetch(`${again.url}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: again.url }, body: JSON.stringify({ email: 'admin@example.com', password: 'admin-password-123' }) })
    expect(login.status).toBe(200)
    const cookie = login.headers.getSetCookie().map(x => x.split(';')[0]).join('; ')
    const list = await fetch(`${again.url}/api/upstreams/${up.id}`, { headers: { cookie } }).then(r => r.json()) as UpstreamDetail
    expect(list.slug).toBe('f')
    await new Promise(r => setTimeout(r, 5500))
    const dash = await fetch(`${again.url}/api/dashboard`, { headers: { cookie } }).then(r => r.json()) as { clients: Array<{ kind: string, lastActiveAt: string | null }> }
    expect(dash.clients.find(x => x.kind === 'pat')?.lastActiveAt).not.toBeNull() // call_stat from the drain flush
  } finally {
    expect(await again.stop()).toBe(0)
  }
}, 120_000)
