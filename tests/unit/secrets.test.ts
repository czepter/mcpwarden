import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from '../../server/gateway/crypto/secrets'

const mk = Buffer.alloc(32, 7)
const ctx = { upstreamId: 'up-1', kind: 'bearer', name: '' }

describe('secrets', () => {
  it('roundtrip, ciphertext hides plaintext', () => {
    const c = encryptSecret(mk, 'userA', ctx, 'sk-supersecret')
    expect(c.startsWith('v1.')).toBe(true)
    expect(c).not.toContain('supersecret')
    expect(decryptSecret(mk, 'userA', ctx, c)).toBe('sk-supersecret')
  })
  it('random IV: same plaintext differs', () => {
    expect(encryptSecret(mk, 'a', ctx, 'x')).not.toBe(encryptSecret(mk, 'a', ctx, 'x'))
  })
  it('other user cannot decrypt', () => {
    const c = encryptSecret(mk, 'userA', ctx, 'x')
    expect(() => decryptSecret(mk, 'userB', ctx, c)).toThrow()
  })
  it('swapped row (other upstream/kind/name) fails', () => {
    const c = encryptSecret(mk, 'userA', ctx, 'x')
    expect(() => decryptSecret(mk, 'userA', { ...ctx, upstreamId: 'up-2' }, c)).toThrow()
    expect(() => decryptSecret(mk, 'userA', { ...ctx, kind: 'header' }, c)).toThrow()
    expect(() => decryptSecret(mk, 'userA', { ...ctx, name: 'X' }, c)).toThrow()
  })
  it('other master key fails; tampering fails; garbage fails', () => {
    const c = encryptSecret(mk, 'userA', ctx, 'x')
    expect(() => decryptSecret(Buffer.alloc(32, 8), 'userA', ctx, c)).toThrow()
    const parts = c.split('.')
    parts[2] = Buffer.from('zz').toString('base64url')
    expect(() => decryptSecret(mk, 'userA', ctx, parts.join('.'))).toThrow()
    expect(() => decryptSecret(mk, 'userA', ctx, 'nope')).toThrow()
  })
  it('fixed test vector (format stability; AAD is length-prefixed since L10, nothing was persisted before)', () => {
    const iv = Buffer.alloc(12, 1)
    const c = encryptSecret(Buffer.alloc(32, 0), 'u', { upstreamId: 'a', kind: 'bearer', name: '' }, 'hello', iv)
    expect(c).toBe('v1.AQEBAQEBAQEBAQEB.mHYaxuA.bjFCbZkvXp-sYGy4Pzlo3g')
    expect(decryptSecret(Buffer.alloc(32, 0), 'u', { upstreamId: 'a', kind: 'bearer', name: '' }, c)).toBe('hello')
  })
  it('rejects wrong master key length', () => {
    expect(() => encryptSecret(Buffer.alloc(16), 'u', ctx, 'x')).toThrow()
  })

  describe('format hardening', () => {
    const valid = () => encryptSecret(mk, 'userA', ctx, 'hello world').split('.')
    const dec = (p: string[]) => decryptSecret(mk, 'userA', ctx, p.join('.'))
    it.each([4, 8, 12])('rejects truncated tag (%i bytes)', n => {
      const p = valid()
      p[3] = Buffer.from(p[3]!, 'base64url').subarray(0, n).toString('base64url')
      expect(() => dec(p)).toThrow('invalid secret format')
    })
    it.each([8, 16])('rejects IV of %i bytes', n => {
      const p = valid()
      p[1] = Buffer.alloc(n, 1).toString('base64url')
      expect(() => dec(p)).toThrow('invalid secret format')
    })
    it('rejects flipped ciphertext bit', () => {
      const p = valid()
      const b = Buffer.from(p[2]!, 'base64url')
      b[0]! ^= 1
      p[2] = b.toString('base64url')
      expect(() => dec(p)).toThrow()
    })
    it('rejects wrong userId', () => {
      expect(() => decryptSecret(mk, 'userB', ctx, valid().join('.'))).toThrow()
    })
    it.each([1, 2, 3])('rejects non-canonical base64url in part %i', i => {
      for (const mutate of [(x: string) => x + '!!', (x: string) => x + '=', (x: string) => 'A' + x.slice(1) + '$']) {
        const p = valid()
        p[i] = mutate(p[i]!)
        expect(() => dec(p)).toThrow()
      }
    })
  })
})
