// Rate limits (sign-in, /oauth2/register, invitation info) and TRUST_PROXY (review H-B, spec P0-10).
// The harness otherwise starts with TRUST_PROXY=true (the test client plays the reverse proxy); this is overridden deliberately here.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registerClient } from '../helpers/oauth-client'
import { api, createInstance, startServer, type TestInstance, type TestServer } from './harness'

const attempt = (c: ReturnType<typeof api>) => c.request('/api/auth/sign-in/email', { body: { email: 'a@example.com', password: 'wrong-wrong-123' } })

describe('TRUST_PROXY unset: X-Forwarded-For is never trusted (direct exposure)', () => {
  let inst: TestInstance
  let srv: TestServer
  beforeAll(async () => {
    inst = await createInstance()
    srv = await startServer(inst, { rateLimit: true, env: { TRUST_PROXY: undefined } })
  })
  afterAll(async () => {
    await srv?.stop()
    await inst?.cleanup()
  })

  it('rotating X-Forwarded-For does not bypass the sign-in limit', async () => {
    const codes: number[] = []
    for (let i = 0; i < 15; i++) codes.push((await attempt(api(srv.url, `198.51.100.${i + 1}`))).status)
    expect(codes).toContain(429)
  })
  it('rotating X-Forwarded-For does not bypass the DCR limit (/oauth2/register)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 12; i++) codes.push((await registerClient(srv.url, {}, `203.0.113.${i + 1}`)).status)
    expect(codes).toContain(429)
  })
  it('rotating X-Forwarded-For does not bypass the invite-info limit', async () => {
    const codes: number[] = []
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${srv.url}/api/invites/${'z'.repeat(43)}`, { headers: { 'x-forwarded-for': `192.0.2.${i + 1}` } })
      codes.push(r.status)
    }
    expect(codes).toContain(429)
  })
  it('a client-supplied internal client-ip header is ignored', async () => {
    // an own bucket per (forged) value would be the bypass; the socket address is already exhausted
    const r = await fetch(`${srv.url}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': srv.url, 'x-mcpw-client-ip': '192.0.2.250' },
      body: JSON.stringify({ email: 'a@example.com', password: 'wrong-wrong-123' }),
    })
    expect(r.status).toBe(429)
  })
})

describe('TRUST_PROXY=true: the right-most X-Forwarded-For hop is the client', () => {
  let inst: TestInstance
  let srv: TestServer
  beforeAll(async () => {
    inst = await createInstance()
    srv = await startServer(inst, { rateLimit: true, env: { TRUST_PROXY: 'true' } })
  })
  afterAll(async () => {
    await srv?.stop()
    await inst?.cleanup()
  })

  const withXff = (xff: string) => fetch(`${srv.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': srv.url, 'x-forwarded-for': xff },
    body: JSON.stringify({ email: 'a@example.com', password: 'wrong-wrong-123' }),
  }).then(r => r.status)

  it('a spoofed left value does not shift the bucket; the proxy-appended hop does', async () => {
    const codes: number[] = []
    for (let i = 0; i < 15; i++) codes.push(await withXff(`6.6.6.${i + 1}, 198.51.100.77`))
    expect(codes).toContain(429)
  })
  it('different real clients behind the proxy get separate buckets (no single global bucket)', async () => {
    const codes: number[] = []
    for (let i = 0; i < 15; i++) codes.push(await withXff(`10.1.1.1, 203.0.113.${100 + i}`))
    expect(codes).not.toContain(429)
  })
  it('invite info is limited per resolved client, not per proxy socket', async () => {
    const get = (ip: string) => fetch(`${srv.url}/api/invites/${'z'.repeat(43)}`, { headers: { 'x-forwarded-for': ip } }).then(r => r.status)
    const codes: number[] = []
    for (let i = 0; i < 35; i++) codes.push(await get('192.0.2.10'))
    expect(codes).toContain(429)
    expect(await get('192.0.2.11')).toBe(200)
  })
})
