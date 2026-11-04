import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig } from '../../server/utils/config'

const KEY = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU='
const SECRET = 's'.repeat(40)
const ok = { BASE_URL: 'https://mcp.example.com', BETTER_AUTH_SECRET: SECRET, MASTER_KEY: KEY }

const errors = (env: Record<string, string>) => {
  try {
    parseConfig(env)
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError)
    return (e as ConfigError).message
  }
  throw new Error('kein Fehler')
}

describe('parseConfig', () => {
  it('gueltig, Defaults', () => {
    const c = parseConfig(ok)
    expect(c.masterKey.length).toBe(32)
    expect(c.dataDir).toBe('./data')
    expect(c.allowedOrigins).toEqual(['https://mcp.example.com'])
    expect(c.databaseUrl).toBeUndefined()
    expect(c.rateLimitEnabled).toBe(true)
    expect(Object.isFrozen(c)).toBe(true)
  })
  it('Hex-Key', () => {
    expect(parseConfig({ ...ok, MASTER_KEY: 'ab'.repeat(32) }).masterKey.length).toBe(32)
  })
  it('fehlende Pflichtvariablen', () => {
    const m = errors({})
    for (const n of ['BASE_URL', 'BETTER_AUTH_SECRET', 'MASTER_KEY']) expect(m).toContain(n)
  })
  it('falsche Key-Laenge', () => expect(errors({ ...ok, MASTER_KEY: 'abcd' })).toContain('MASTER_KEY'))
  it('kurzes Secret', () => expect(errors({ ...ok, BETTER_AUTH_SECRET: 'kurz' })).toContain('BETTER_AUTH_SECRET'))
  it('http nicht-localhost abgelehnt, localhost erlaubt', () => {
    expect(errors({ ...ok, BASE_URL: 'http://example.com' })).toContain('BASE_URL')
    expect(parseConfig({ ...ok, BASE_URL: 'http://localhost:3000' }).baseUrl.hostname).toBe('localhost')
  })
  it('leere DATABASE_URL = undefined, falsches Schema abgelehnt', () => {
    expect(parseConfig({ ...ok, DATABASE_URL: '' }).databaseUrl).toBeUndefined()
    expect(errors({ ...ok, DATABASE_URL: 'mysql://x' })).toContain('DATABASE_URL')
    expect(parseConfig({ ...ok, DATABASE_URL: 'postgres://u:p@h/d' }).databaseUrl).toBeDefined()
  })
  it('RATE_LIMIT', () => {
    expect(parseConfig({ ...ok, RATE_LIMIT: 'off' }).rateLimitEnabled).toBe(false)
    expect(errors({ ...ok, RATE_LIMIT: 'x' })).toContain('RATE_LIMIT')
  })
  it('ALLOWED_ORIGINS', () => {
    expect(parseConfig({ ...ok, ALLOWED_ORIGINS: 'https://a.example/x, https://b.example' }).allowedOrigins)
      .toEqual(['https://a.example', 'https://b.example'])
    expect(errors({ ...ok, ALLOWED_ORIGINS: 'nope' })).toContain('ALLOWED_ORIGINS')
  })
  it('Meldung enthaelt keine Secrets', () => {
    const m = errors({ ...ok, MASTER_KEY: 'GEHEIM-GEHEIM', BETTER_AUTH_SECRET: 'GEHEIMKURZ', BASE_URL: 'http://evil.example' })
    expect(m).not.toContain('GEHEIM')
    expect(m).not.toContain('evil.example')
  })
})
