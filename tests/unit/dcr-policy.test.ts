import { describe, expect, it } from 'vitest'
import {
  BUILTIN_ALLOWLIST, checkRedirectUri, evaluateRegistration, matchesAllowlist, matchesRedirectPattern,
  redirectHost, sanitizeClientName,
} from '../../server/auth/dcr-policy'

describe('checkRedirectUri', () => {
  it.each([
    ['https://example.com/cb', true],
    ['http://localhost:53124/callback', true],
    ['http://127.0.0.1:1234/cb', true],
    ['http://[::1]:8080/cb', true],
    ['cursor://anysphere.cursor/mcp/callback', true],
    ['http://evil.com/cb', false],
    ['http://localhost.evil.com/cb', false],
    ['http://user:pw@localhost/cb', false],
    ['https://user@example.com/cb', false],
    ['javascript:alert(1)', false],
    ['data:text/html,x', false],
    ['file:///etc/passwd', false],
    ['https://example.com/cb#frag', false],
    ['https://*.example.com/cb', false],
    ['not a uri', false],
    ['', false],
  ])('%s -> %s', (uri, ok) => {
    expect(checkRedirectUri(uri).ok).toBe(ok)
  })
})

describe('matchesRedirectPattern', () => {
  it.each([
    ['http://localhost:*', 'http://localhost:53124/callback', true],
    ['http://localhost:*', 'http://localhost/callback', true],
    ['http://localhost:*', 'http://localhost.evil.com:80/cb', false],
    ['http://localhost:*', 'http://evil.com/?x=http://localhost:1', false],
    ['http://localhost:*', 'https://localhost:1/cb', false],
    ['http://127.0.0.1:*', 'http://localhost:1/cb', false],
    ['http://[::1]:*', 'http://[::1]:9/cb', true],
    ['http://localhost:3000', 'http://localhost:3000/cb', true],
    ['http://localhost:3000', 'http://localhost:3001/cb', false],
    ['cursor://', 'cursor://anysphere.cursor/cb', true],
    ['cursor://', 'cursor://', true],
    ['cursor://', 'vscode://x', false],
    ['https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback', true],
    ['https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback/x', false],
    ['https://claude.ai/api/mcp/auth_callback', 'https://evil.claude.ai/api/mcp/auth_callback', false],
    ['https://a.com/app/*', 'https://a.com/app/x/y', true],
    ['https://a.com/app/*', 'https://a.com/other', false],
  ])('%s vs %s -> %s', (pattern, uri, expected) => {
    expect(matchesRedirectPattern(pattern, uri)).toBe(expected)
  })
})

describe('matchesAllowlist', () => {
  const claudeCode = BUILTIN_ALLOWLIST[0]!
  it('requires name AND all redirects to match', () => {
    expect(matchesAllowlist(claudeCode, 'Claude Code (mcpwarden)', ['http://127.0.0.1:53124/callback'])).toBe(true)
    expect(matchesAllowlist(claudeCode, 'Claude Code', ['http://evil.example/cb'])).toBe(false)
    expect(matchesAllowlist(claudeCode, 'Unknown Tool', ['http://127.0.0.1:53124/callback'])).toBe(false)
    expect(matchesAllowlist(claudeCode, 'Claude Code', ['http://127.0.0.1:1/cb', 'https://evil.example/cb'])).toBe(false)
    expect(matchesAllowlist(claudeCode, 'Claude Code', [])).toBe(false)
  })
  it('is case-insensitive on names and does not treat name as regex', () => {
    expect(matchesAllowlist(claudeCode, 'claude CODE x', ['http://localhost:1/cb'])).toBe(true)
    expect(matchesAllowlist({ ...claudeCode, namePattern: 'a.b' }, 'axb', ['http://localhost:1/cb'])).toBe(false)
  })
})

describe('evaluateRegistration', () => {
  const ok = { clientName: 'Claude Code', redirectUris: ['http://127.0.0.1:53124/callback'] }
  const unknown = { clientName: 'Mystery App', redirectUris: ['http://127.0.0.1:1/cb'] }

  it('off rejects everything with 403', () => {
    expect(evaluateRegistration('off', BUILTIN_ALLOWLIST, ok)).toMatchObject({ allow: false, status: 403, error: 'access_denied' })
  })
  it('allowlist accepts listed, rejects unlisted', () => {
    expect(evaluateRegistration('allowlist', BUILTIN_ALLOWLIST, ok)).toEqual({ allow: true, allowlisted: true })
    expect(evaluateRegistration('allowlist', BUILTIN_ALLOWLIST, unknown)).toMatchObject({ allow: false, status: 400, error: 'invalid_client_metadata' })
  })
  it('open accepts unlisted with allowlisted=false', () => {
    expect(evaluateRegistration('open', BUILTIN_ALLOWLIST, unknown)).toEqual({ allow: true, allowlisted: false })
    expect(evaluateRegistration('open', BUILTIN_ALLOWLIST, ok)).toEqual({ allow: true, allowlisted: true })
  })
  it('rejects unsafe or missing redirects in every mode but off', () => {
    for (const mode of ['allowlist', 'open'] as const) {
      expect(evaluateRegistration(mode, BUILTIN_ALLOWLIST, { clientName: 'Claude Code', redirectUris: ['http://evil.example/cb'] }))
        .toMatchObject({ allow: false, status: 400, error: 'invalid_redirect_uri' })
      expect(evaluateRegistration(mode, BUILTIN_ALLOWLIST, { clientName: 'x', redirectUris: [] }))
        .toMatchObject({ allow: false, error: 'invalid_redirect_uri' })
      expect(evaluateRegistration(mode, BUILTIN_ALLOWLIST, { clientName: 'x', redirectUris: ['javascript:alert(1)'] }))
        .toMatchObject({ allow: false, error: 'invalid_redirect_uri' })
    }
  })
})

describe('helpers', () => {
  it('sanitizeClientName strips control chars and truncates to 80', () => {
    expect(sanitizeClientName('a\nb\u0000c')).toBe('a b c')
    expect(sanitizeClientName('x'.repeat(200))).toHaveLength(80)
    expect(sanitizeClientName(undefined)).toBe('')
  })
  it('redirectHost', () => {
    expect(redirectHost('http://127.0.0.1:53124/callback')).toBe('127.0.0.1:53124')
    expect(redirectHost('cursor://')).toBe('cursor:')
    expect(redirectHost('garbage')).toBe('')
  })
})
