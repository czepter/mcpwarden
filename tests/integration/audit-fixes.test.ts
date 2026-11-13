// Regression tests for the security-audit fixes that need the built server (body bounds, sign-up serialisation on every route).
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { api, createInstance, signUpFirstAdmin, startServer, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

/** Raw request line: no client-side URL normalisation, so `%2e%2e` reaches the server as sent. */
function raw(path: string, body: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number, text: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: srv.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'origin': srv.url, ...headers } }, (res) => {
      let text = ''
      res.on('data', d => (text += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('sign-up serialisation on every route', () => {
  it('concurrent first registrations through both routes yield exactly one account (and one admin)', async () => {
    const paths = ['/api/auth/sign-up/email', '/.well-known/%2e%2e/api/auth/sign-up/email']
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => raw(paths[i % 2]!, JSON.stringify({ name: `U${i}`, email: `race${i}@example.com`, password: 'race-password-123' }))))
    expect(results.filter(r => r.status === 200)).toHaveLength(1)
  })
})

describe('request body bounds', () => {
  it('/api/auth/** refuses an oversized body with 413 before authentication', async () => {
    const r = await raw('/api/auth/sign-in/email', JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(300 * 1024) }))
    expect(r.status).toBe(413)
  })
  it('/api/** refuses a declared oversized body with 413', async () => {
    const admin = await signUpFirstAdminSafe()
    const r = await raw('/api/upstreams/probe', '{"url":"https://example.com/' + 'a'.repeat(1024 * 1024) + '"}', { cookie: [...admin.jar].map(([k, v]) => `${k}=${v}`).join('; ') })
    expect(r.status).toBe(413)
  })
})

async function signUpFirstAdminSafe() {
  // The race test above already created the first account; sign in as it.
  const c = api(srv.url)
  const r = await c.request('/api/auth/sign-in/email', { body: { email: 'race0@example.com', password: 'race-password-123' } })
  if (r.status === 200) return c
  // Which race winner exists is not deterministic: find it.
  for (let i = 1; i < 6; i++) {
    const rr = await c.request('/api/auth/sign-in/email', { body: { email: `race${i}@example.com`, password: 'race-password-123' } })
    if (rr.status === 200) return c
  }
  return signUpFirstAdmin(srv)
}

describe('security response headers', () => {
  it('pages carry a CSP that hashes exactly their inline scripts, plus the base headers', async () => {
    const res = await fetch(`${srv.url}/login`)
    expect(res.status).toBe(200)
    const csp = res.headers.get('content-security-policy') ?? ''
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('referrer-policy')).toBe('same-origin')
    const html = await res.text()
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m => !/\bsrc\s*=/.test(m[1]!) && !/application\/json/.test(m[1]!))
    expect(inline.length).toBeGreaterThan(0) // the theme script at least
    for (const m of inline) expect(csp).toContain(`'sha256-${createHash('sha256').update(m[2]!, 'utf8').digest('base64')}'`)
  })
  it('API, discovery and health responses are locked down and unframeable', async () => {
    for (const p of ['/api/public-config', '/healthz', '/.well-known/oauth-protected-resource/mcp']) {
      const res = await fetch(`${srv.url}${p}`)
      expect(res.headers.get('content-security-policy'), p).toContain("default-src 'none'")
      expect(res.headers.get('x-frame-options'), p).toBe('DENY')
      expect(res.headers.get('x-content-type-options'), p).toBe('nosniff')
    }
  })
})
