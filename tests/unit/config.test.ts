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
  throw new Error('no error')
}

describe('parseConfig', () => {
  it('valid, defaults', () => {
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
  it('missing required variables', () => {
    const m = errors({})
    for (const n of ['BASE_URL', 'BETTER_AUTH_SECRET', 'MASTER_KEY']) expect(m).toContain(n)
  })
  it('non-canonical Base64 (stray bits set) is rejected', () => {
    expect(errors({ ...ok, MASTER_KEY: KEY.replace('NDU=', 'NDV=') })).toContain('MASTER_KEY')
    expect(errors({ ...ok, MASTER_KEY: KEY.replace('=', '') })).toContain('MASTER_KEY')
  })
  it('wrong key length', () => expect(errors({ ...ok, MASTER_KEY: 'abcd' })).toContain('MASTER_KEY'))
  it('short secret', () => expect(errors({ ...ok, BETTER_AUTH_SECRET: 'short' })).toContain('BETTER_AUTH_SECRET'))
  it('http for non-localhost rejected, localhost allowed', () => {
    expect(errors({ ...ok, BASE_URL: 'http://example.com' })).toContain('BASE_URL')
    expect(parseConfig({ ...ok, BASE_URL: 'http://localhost:3000' }).baseUrl.hostname).toBe('localhost')
  })
  it('empty DATABASE_URL = undefined, wrong scheme rejected', () => {
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
  it('message contains no secrets', () => {
    const m = errors({ ...ok, MASTER_KEY: 'LEAKED-LEAKED', BETTER_AUTH_SECRET: 'LEAKEDSHORT', BASE_URL: 'http://evil.example' })
    expect(m).not.toContain('LEAKED')
    expect(m).not.toContain('evil.example')
  })

  describe('SMTP_URL / MAIL_FROM', () => {
    const smtp = { ...ok, SMTP_URL: 'smtps://us%40er:p%3Ass@mail.example.com:465', MAIL_FROM: 'mcpwarden <noreply@example.com>' }
    it('without SMTP_URL: no mailer config, MAIL_FROM alone does no harm', () => {
      expect(parseConfig(ok).smtp).toBeUndefined()
      expect(parseConfig({ ...ok, MAIL_FROM: 'a@b.de' }).smtp).toBeUndefined()
      expect(parseConfig({ ...ok, SMTP_URL: '' }).smtp).toBeUndefined()
    })
    it('smtps: port 465, credentials decoded', () => {
      const c = parseConfig(smtp)
      expect(c.smtp).toMatchObject({ host: 'mail.example.com', port: 465, secure: true, user: 'us@er', pass: 'p:ss' })
      expect(c.mailFrom).toBe('mcpwarden <noreply@example.com>')
    })
    it('smtp: STARTTLS, default port 587, without auth', () => {
      expect(parseConfig({ ...smtp, SMTP_URL: 'smtp://relay.example.com' }).smtp).toMatchObject({ port: 587, secure: false, user: undefined })
      expect(parseConfig({ ...smtp, SMTP_URL: 'smtp://relay.example.com:2525' }).smtp?.port).toBe(2525)
    })
    it('password never appears in JSON or inspect output of the configuration', () => {
      const c = parseConfig(smtp)
      expect(JSON.stringify(c)).not.toContain('p:ss')
      expect(JSON.stringify(c)).not.toContain('p%3Ass')
      expect(String(Object.keys(c.smtp!))).not.toContain('pass')
    })
    it('MAIL_FROM required when SMTP_URL is set', () => {
      expect(errors({ ...ok, SMTP_URL: 'smtp://h.example.com' })).toContain('MAIL_FROM')
    })
    it('MAIL_FROM: invalid or with a line break rejected', () => {
      for (const f of ['nope', 'a@b.de\nBcc: x@y.de', 'a@b.de\r\nX: 1', 'Name <a@b.de>, c@d.de', '<a@b.de>']) {
        expect(errors({ ...smtp, MAIL_FROM: f }), f).toContain('MAIL_FROM')
      }
      expect(parseConfig({ ...smtp, MAIL_FROM: 'noreply@example.com' }).mailFrom).toBe('noreply@example.com')
    })
    it('invalid URL: only the variable name in the message, never credentials', () => {
      for (const u of ['not a url', 'http://u:LEAKEDPW@h.example.com', 'smtp://u:LEAKEDPW@h.example.com:99999', 'smtp://u:LEAKEDPW@h.example.com/path', 'smtp://:LEAKEDPW@h.example.com', 'smtp://u:%E0%A4%A@h.example.com']) {
        const m = errors({ ...smtp, SMTP_URL: u })
        expect(m, u).toContain('SMTP_URL')
        expect(m, u).not.toContain('LEAKEDPW')
      }
    })
  })
})
