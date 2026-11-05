import { describe, expect, it } from 'vitest'
import { parseConfig } from '../../server/utils/config'
import { resolveClientIp } from '../../server/utils/client-ip'

describe('resolveClientIp (TRUST_PROXY, review H-B)', () => {
  const socketIp = '172.18.0.2'

  it('without a trusted proxy X-Forwarded-For is ignored entirely', () => {
    expect(resolveClientIp({ forwardedFor: '203.0.113.9', socketIp, trustProxy: 0 })).toBe(socketIp)
    expect(resolveClientIp({ forwardedFor: '1.1.1.1, 2.2.2.2', socketIp, trustProxy: 0 })).toBe(socketIp)
  })
  it('one trusted proxy: the right-most entry, never a client-supplied left value', () => {
    expect(resolveClientIp({ forwardedFor: '203.0.113.9', socketIp, trustProxy: 1 })).toBe('203.0.113.9')
    expect(resolveClientIp({ forwardedFor: '6.6.6.6, 7.7.7.7, 203.0.113.9', socketIp, trustProxy: 1 })).toBe('203.0.113.9')
  })
  it('N trusted proxies: the N-th entry from the right', () => {
    expect(resolveClientIp({ forwardedFor: '6.6.6.6, 203.0.113.9, 10.0.0.5', socketIp, trustProxy: 2 })).toBe('203.0.113.9')
  })
  it('a chain shorter than the trusted hops, a non-IP entry or a missing header fall back to the socket address', () => {
    expect(resolveClientIp({ forwardedFor: '203.0.113.9', socketIp, trustProxy: 2 })).toBe(socketIp)
    expect(resolveClientIp({ forwardedFor: 'not-an-ip', socketIp, trustProxy: 1 })).toBe(socketIp)
    expect(resolveClientIp({ forwardedFor: 'unknown, ', socketIp, trustProxy: 1 })).toBe(socketIp)
    expect(resolveClientIp({ forwardedFor: undefined, socketIp, trustProxy: 1 })).toBe(socketIp)
  })
  it('IPv6 entries are accepted', () => {
    expect(resolveClientIp({ forwardedFor: '2001:db8::7', socketIp, trustProxy: 1 })).toBe('2001:db8::7')
  })
  it('no usable address at all yields undefined', () => {
    expect(resolveClientIp({ forwardedFor: 'x', socketIp: undefined, trustProxy: 1 })).toBeUndefined()
  })
})

describe('TRUST_PROXY in parseConfig', () => {
  const ok = { BASE_URL: 'https://mcp.example.com', BETTER_AUTH_SECRET: 's'.repeat(40), MASTER_KEY: 'ab'.repeat(32) }
  it('defaults to off', () => {
    expect(parseConfig(ok).trustProxy).toBe(0)
    expect(parseConfig({ ...ok, TRUST_PROXY: 'false' }).trustProxy).toBe(0)
    expect(parseConfig({ ...ok, TRUST_PROXY: '' }).trustProxy).toBe(0)
  })
  it('true is one hop, a number is that many hops', () => {
    expect(parseConfig({ ...ok, TRUST_PROXY: 'true' }).trustProxy).toBe(1)
    expect(parseConfig({ ...ok, TRUST_PROXY: 'TRUE' }).trustProxy).toBe(1)
    expect(parseConfig({ ...ok, TRUST_PROXY: '2' }).trustProxy).toBe(2)
  })
  it('anything else fails fast without echoing the value', () => {
    expect(() => parseConfig({ ...ok, TRUST_PROXY: 'maybe' })).toThrowError(/TRUST_PROXY/)
    expect(() => parseConfig({ ...ok, TRUST_PROXY: '-1' })).toThrowError(/TRUST_PROXY/)
    try { parseConfig({ ...ok, TRUST_PROXY: 'GEHEIMWERT' }) } catch (e) { expect((e as Error).message).not.toContain('GEHEIMWERT') }
  })
})
