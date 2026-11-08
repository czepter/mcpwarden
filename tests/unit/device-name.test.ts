import { describe, expect, it } from 'vitest'
import { guessDeviceName, sanitizeDeviceName } from '../../server/auth/device-name'

describe('sanitizeDeviceName', () => {
  it('trims, collapses whitespace and treats empty as "no label"', () => {
    expect(sanitizeDeviceName('  MacBook   Pro ')).toBe('MacBook Pro')
    expect(sanitizeDeviceName('   ')).toBeNull()
    expect(sanitizeDeviceName(null)).toBeNull()
    expect(sanitizeDeviceName(undefined)).toBeNull()
  })
  it('strips control, bidi and zero-width characters', () => {
    expect(sanitizeDeviceName('NA‮S​\u0007')).toBe('NAS')
  })
  it('rejects non-strings and values over 64 characters', () => {
    expect(sanitizeDeviceName(42)).toBeUndefined()
    expect(sanitizeDeviceName('x'.repeat(65))).toBeUndefined()
    expect(sanitizeDeviceName('x'.repeat(64))).toBe('x'.repeat(64))
  })
})

describe('guessDeviceName', () => {
  it('keeps only OS and browser family', () => {
    expect(guessDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15')).toBe('Mac · Safari')
    expect(guessDeviceName('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0')).toBe('Linux · Firefox')
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0')).toBe('Windows · Edge')
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari')
  })
  it('returns null for unknown or missing agents and never echoes the string', () => {
    expect(guessDeviceName(undefined)).toBeNull()
    expect(guessDeviceName('curl/8.5.0')).toBeNull()
  })
})
