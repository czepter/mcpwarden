import { describe, expect, it } from 'vitest'
import { APIError } from 'better-auth/api'
import { bufferRequest, dispatchAuth, isSignUp, MAX_AUTH_BODY_BYTES } from '../../server/utils/auth-dispatch'
import { bodyLimitViolation, MAX_API_BODY_BYTES } from '../../server/utils/body-limit'
import { capResponse, UpstreamResponseTooLargeError } from '../../server/gateway/net/safe-fetch'
import { sanitizeUntrusted } from '../../server/mail/templates'
import { withRecipientLimit } from '../../server/mail/ratelimit'
import { createMemoryMailer } from '../../server/mail/memory'
import { Limiter } from '../../server/gateway/upstream/limiter'
import { dcrBefore, MAX_CLIENT_NAME_LENGTH, MAX_REDIRECT_URIS, type DcrDeps } from '../../server/auth/dcr-hook'
import { checkArguments } from '../../server/gateway/rest/template'
import { assertUrlAllowed, SsrfBlockedError } from '../../server/gateway/net/ssrf'

const post = (url: string, body = '{}') => new Request(url, { method: 'POST', body, headers: { 'content-type': 'application/json' } })

describe('sign-up mutex (audit: auth.signup-mutex-*)', () => {
  it('decides on the normalised URL, so a dot-segment target through /.well-known is still a sign-up', () => {
    expect(isSignUp(post('http://x.test/api/auth/sign-up/email'))).toBe(true)
    expect(isSignUp(post('http://x.test/.well-known/%2e%2e/api/auth/sign-up/email'))).toBe(true)
    expect(isSignUp(post('http://x.test/api/auth/sign-in/email'))).toBe(false)
    expect(isSignUp(new Request('http://x.test/api/auth/sign-up/email'))).toBe(false)
  })
  it('serialises concurrent sign-ups on both routes', async () => {
    let running = 0
    let overlap = false
    const auth = { handler: async () => { running++; if (running > 1) overlap = true; await new Promise(r => setTimeout(r, 10)); running--; return new Response('ok') } }
    await Promise.all([
      dispatchAuth(auth, post('http://x.test/api/auth/sign-up/email')),
      dispatchAuth(auth, post('http://x.test/.well-known/%2e%2e/api/auth/sign-up/email')),
      dispatchAuth(auth, post('http://x.test/api/auth/sign-up/email')),
    ])
    expect(overlap).toBe(false)
  })
  it('reads the body before taking the lock: a stalled body does not block other sign-ups', async () => {
    const stalled = new Request('http://x.test/api/auth/sign-up/email', { method: 'POST', body: new ReadableStream({ start() { /* never delivers */ } }), duplex: 'half' } as RequestInit)
    const auth = { handler: async () => new Response('ok') }
    void dispatchAuth(auth, stalled)
    const res = await Promise.race([dispatchAuth(auth, post('http://x.test/api/auth/sign-up/email')), new Promise<null>(r => setTimeout(() => r(null), 500))])
    expect(res).not.toBeNull()
  })
  it('refuses bodies above the bound, with or without Content-Length', async () => {
    const auth = { handler: async () => new Response('ok') }
    const big = 'x'.repeat(MAX_AUTH_BODY_BYTES + 1)
    expect((await dispatchAuth(auth, post('http://x.test/api/auth/sign-in/email', big))).status).toBe(413)
    const chunked = new Request('http://x.test/api/auth/sign-in/email', { method: 'POST', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_AUTH_BODY_BYTES + 1)); c.close() } }), duplex: 'half' } as RequestInit)
    expect(await bufferRequest(chunked, MAX_AUTH_BODY_BYTES)).toBeNull()
    expect((await dispatchAuth(auth, post('http://x.test/api/auth/sign-in/email', 'x'))).status).toBe(200)
  })
})

describe('bodyLimitViolation (audit: api.request-body-unbounded-read)', () => {
  const v = (o: Partial<Parameters<typeof bodyLimitViolation>[0]>) => bodyLimitViolation({ method: 'POST', path: '/api/upstreams', contentLength: '10', ...o })
  it('passes small bodies, refuses large (413) and length-less chunked (411)', () => {
    expect(v({})).toBeNull()
    expect(v({ contentLength: String(MAX_API_BODY_BYTES + 1) })).toBe(413)
    expect(v({ contentLength: undefined, transferEncoding: 'chunked' })).toBe(411)
    expect(v({ contentLength: undefined })).toBeNull()
  })
  it('does not cover safe methods, /api/auth/** (bounded while read) or other paths', () => {
    expect(v({ method: 'GET', contentLength: '99999999' })).toBeNull()
    expect(v({ path: '/api/auth/sign-in/email', contentLength: '99999999' })).toBeNull()
    expect(v({ path: '/mcp', contentLength: '99999999' })).toBeNull()
  })
})

describe('capResponse (audit: gateway.upstream-response-unbounded-mcp-transport)', () => {
  const body = (n: number) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(n)); c.close() } })
  it('passes a body within the bound', async () => {
    const r = capResponse(new Response(body(100), { headers: { 'content-type': 'application/json' } }), 1000, 5000)
    expect((await r.arrayBuffer()).byteLength).toBe(100)
  })
  it('errors the stream when the bound is exceeded while reading', async () => {
    const r = capResponse(new Response(body(2000), { headers: { 'content-type': 'application/json' } }), 1000, 5000)
    await expect(r.arrayBuffer()).rejects.toBeInstanceOf(UpstreamResponseTooLargeError)
  })
  it('refuses a declared oversized body immediately and uses the larger bound for event streams', async () => {
    const decl = new Response(body(10), { headers: { 'content-type': 'application/json', 'content-length': '5000' } })
    expect(() => capResponse(decl, 1000, 5000)).toThrow(UpstreamResponseTooLargeError)
    const sse = capResponse(new Response(body(2000), { headers: { 'content-type': 'text/event-stream' } }), 1000, 5000)
    expect((await sse.arrayBuffer()).byteLength).toBe(2000)
  })
  it('leaves bodiless responses alone', () => {
    const r = new Response(null, { status: 204 })
    expect(capResponse(r)).toBe(r)
  })
})

describe('sanitizeUntrusted bound (audit: mail-sanitize-untrusted-unbounded-regex-dcr-client-name)', () => {
  it('handles huge adversarial input fast and still truncates', () => {
    const t0 = performance.now()
    const out = sanitizeUntrusted('a-'.repeat(500_000) + 'x'.repeat(500_000), 60)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(out.length).toBeLessThanOrEqual(60)
  })
  it('still defuses links and addresses', () => {
    expect(sanitizeUntrusted('see https://evil.example/x or a@b.example', 100)).toBe('see [Link entfernt] or [Adresse entfernt]')
  })
})

describe('mail quota classes (audit: mail-shared-recipient-quota-suppresses-security-mail)', () => {
  const to = 'victim@example.com'
  const mail = { to, subject: 's', text: 't' }
  it('triggering password-reset mails does not use up the notification quota', async () => {
    const inner = createMemoryMailer()
    const m = withRecipientLimit(inner, { max: 3, windowMs: 3_600_000, now: () => 0 })
    for (let i = 0; i < 3; i++) await m.sendMail({ ...mail, quota: 'reset' })
    await expect(m.sendMail({ ...mail, quota: 'reset' })).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(m.sendMail(mail)).resolves.toBeUndefined() // new-client alert still goes out
    expect(inner.outbox).toHaveLength(4)
  })
})

describe('tools/list quota (audit: gateway.tools-list-unthrottled-amplification)', () => {
  it('allows a burst, then refuses with a wait time, per user, and recovers', () => {
    let t = 0
    const l = new Limiter(() => t)
    for (let i = 0; i < 60; i++) expect(l.acquireList('u1')).toBe(0)
    expect(l.acquireList('u1')).toBeGreaterThan(0)
    expect(l.acquireList('u2')).toBe(0)
    t += 2000
    expect(l.acquireList('u1')).toBe(0)
  })
  it('forgetUser clears the list bucket', () => {
    const l = new Limiter(() => 0)
    for (let i = 0; i < 60; i++) l.acquireList('u1')
    l.forgetUser('u1')
    expect(l.acquireList('u1')).toBe(0)
  })
})

describe('DCR metadata bounds (audit: auth.dcr-open-registration-unbounded-growth)', () => {
  const deps = { getPolicy: async () => ({ mode: 'open', allowlist: [] }), recordRegistration: async () => {} } as unknown as DcrDeps
  const reg = '/oauth2/register'
  it('rejects an oversized client_name and too many redirect_uris', async () => {
    await expect(dcrBefore(reg, { client_name: 'x'.repeat(MAX_CLIENT_NAME_LENGTH + 1), redirect_uris: ['https://a.example/cb'] }, deps)).rejects.toBeInstanceOf(APIError)
    const uris = Array.from({ length: MAX_REDIRECT_URIS + 1 }, (_, i) => `https://a.example/cb${i}`)
    await expect(dcrBefore(reg, { client_name: 'ok', redirect_uris: uris }, deps)).rejects.toBeInstanceOf(APIError)
  })
  it('accepts a normal registration', async () => {
    await expect(dcrBefore(reg, { client_name: 'Claude Code', redirect_uris: ['https://a.example/cb'] }, deps)).resolves.toBeUndefined()
  })
})

describe('REST argument check uses own properties only', () => {
  const schema = { type: 'object', properties: { q: { type: 'string' } }, required: [] } as never
  it('refuses prototype-chain names as unknown parameters', () => {
    expect(() => checkArguments(schema, { q: 'x' })).not.toThrow()
    for (const k of ['constructor', 'toString', 'hasOwnProperty']) expect(() => checkArguments(schema, { [k]: 'x' })).toThrow(/Unbekannter Parameter/)
    expect(() => checkArguments(schema, JSON.parse('{"__proto__": "x"}'))).toThrow(/Unbekannter Parameter/)
  })
})

describe('Azure WireServer is blocked', () => {
  it('168.63.129.16 is refused', () => {
    expect(() => assertUrlAllowed('http://168.63.129.16/')).toThrow(SsrfBlockedError)
  })
})
