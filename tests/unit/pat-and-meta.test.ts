import { describe, expect, it } from 'vitest'
import { clientExpiresAt, createUseThrottle, isActive, isExpiredUnused } from '../../server/auth/client-meta'
import { generatePat, hashPat, isPatToken, validatePatName } from '../../server/auth/pat'

describe('pat', () => {
  it('generates prefixed 256-bit tokens with display prefix of 13 chars and matching hash', () => {
    const a = generatePat()
    const b = generatePat()
    expect(a.token).toMatch(/^mcpw_pat_[A-Za-z0-9_-]{43}$/)
    expect(a.prefix).toBe(a.token.slice(0, 13))
    expect(a.prefix).toHaveLength(13)
    expect(a.hash).toBe(hashPat(a.token))
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toContain(a.token)
    expect(isPatToken(a.token)).toBe(true)
    expect(isPatToken('eyJhbGciOi')).toBe(false)
  })
  it('validates names (1..64, trimmed)', () => {
    expect(validatePatName('  laptop ')).toEqual({ ok: true, name: 'laptop' })
    expect(validatePatName('')).toEqual({ ok: false })
    expect(validatePatName('   ')).toEqual({ ok: false })
    expect(validatePatName('x'.repeat(65))).toEqual({ ok: false })
    expect(validatePatName('x'.repeat(64)).ok).toBe(true)
    expect(validatePatName(5)).toEqual({ ok: false })
  })
})

describe('client meta', () => {
  const now = new Date('2026-06-01T12:00:00Z')
  it('isActive: 5 minute window', () => {
    expect(isActive(null, now)).toBe(false)
    expect(isActive(new Date(now.getTime() - 5 * 60_000), now)).toBe(true)
    expect(isActive(new Date(now.getTime() - 5 * 60_000 - 1), now)).toBe(false)
  })
  it('expiresAt only for never-used clients', () => {
    const created = new Date('2026-05-01T00:00:00Z')
    expect(clientExpiresAt(created, null)).toBe('2026-05-31T00:00:00.000Z')
    expect(clientExpiresAt(created, now)).toBeNull()
  })
  it('expiry task rule', () => {
    expect(isExpiredUnused(new Date('2026-04-30T00:00:00Z'), null, now)).toBe(true)
    expect(isExpiredUnused(new Date('2026-05-20T00:00:00Z'), null, now)).toBe(false)
    expect(isExpiredUnused(new Date('2026-04-01T00:00:00Z'), now, now)).toBe(false)
  })
  it('throttle allows once per minute per key', () => {
    let t = 1_000_000
    const allow = createUseThrottle(() => t)
    expect(allow('a')).toBe(true)
    expect(allow('a')).toBe(false)
    expect(allow('b')).toBe(true)
    t += 59_999
    expect(allow('a')).toBe(false)
    t += 1
    expect(allow('a')).toBe(true)
  })
})
