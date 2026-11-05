import { describe, expect, it } from 'vitest'
import { isCsrfViolation, type CsrfInput } from '../../server/utils/csrf'

const base: CsrfInput = { method: 'POST', path: '/api/upstreams', origin: 'https://mcp.example.com', hasAuthorization: false, allowedOrigins: ['https://mcp.example.com'] }
const v = (o: Partial<CsrfInput>) => isCsrfViolation({ ...base, ...o })

describe('isCsrfViolation (review M-G)', () => {
  it('same origin passes, foreign origin and the opaque "null" origin are refused', () => {
    expect(v({})).toBe(false)
    expect(v({ origin: 'https://evil.example' })).toBe(true)
    expect(v({ origin: 'null' })).toBe(true)
    expect(v({ origin: 'https://mcp.example.com.evil.example' })).toBe(true)
  })
  it('ALLOWED_ORIGINS entries pass', () => {
    expect(v({ origin: 'https://app.example.org', allowedOrigins: ['https://mcp.example.com', 'https://app.example.org'] })).toBe(false)
  })
  it('safe methods, /api/auth/** (Better Auth checks itself) and non-api paths are not covered', () => {
    expect(v({ method: 'GET', origin: 'https://evil.example' })).toBe(false)
    expect(v({ method: 'HEAD', origin: 'https://evil.example' })).toBe(false)
    expect(v({ path: '/api/auth/sign-in/email', origin: 'https://evil.example' })).toBe(false)
    expect(v({ path: '/mcp', origin: 'https://evil.example' })).toBe(false)
  })
  it('every mutating method is covered', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(v({ method, origin: 'https://evil.example' })).toBe(true)
  })
  it('Authorization (PAT/Bearer) requests are exempt', () => {
    expect(v({ origin: 'https://evil.example', hasAuthorization: true })).toBe(false)
  })
  it('without Origin, Sec-Fetch-Site decides; neither header means no browser', () => {
    expect(v({ origin: undefined, secFetchSite: 'cross-site' })).toBe(true)
    expect(v({ origin: undefined, secFetchSite: 'same-site' })).toBe(true)
    expect(v({ origin: undefined, secFetchSite: 'same-origin' })).toBe(false)
    expect(v({ origin: undefined, secFetchSite: 'none' })).toBe(false)
    expect(v({ origin: undefined })).toBe(false)
  })
})
