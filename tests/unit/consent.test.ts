import { describe, expect, it } from 'vitest'
import { buildConsentInfo, buildConsentScopes, consentRedirect, validateAcceptedScopes } from '../../server/auth/consent'
import { BUILTIN_ALLOWLIST } from '../../server/auth/dcr-policy'
import { parseScopeString } from '../../server/auth/scopes'
import type { ConsentInfo } from '../../shared/api-types'

const base = new URL('http://localhost:3000')
const claude = { id: 'c1', name: 'Claude Code (x)', redirectUris: ['http://127.0.0.1:5/cb'], registeredAt: new Date('2026-01-01T00:00:00Z'), viaDcr: true }

describe('buildConsentScopes', () => {
  it('keeps only known scopes, all required', () => {
    expect(buildConsentScopes(['openid', 'offline_access', 'mcp:tools', 'evil'])).toEqual([
      { name: 'openid', required: true }, { name: 'offline_access', required: true }, { name: 'mcp:tools', required: true },
    ])
  })
  it('never offers the admin scope while disabled', () => {
    expect(buildConsentScopes(['mcp:tools', 'mcpwarden:admin']).map(s => s.name)).toEqual(['mcp:tools'])
  })
  it('offers the admin scope as optional once enabled', () => {
    expect(buildConsentScopes(['mcp:tools', 'mcpwarden:admin'], true).at(-1)).toEqual({ name: 'mcpwarden:admin', required: false })
  })
})

describe('validateAcceptedScopes', () => {
  const offered = buildConsentScopes(['openid', 'offline_access', 'mcp:tools', 'mcpwarden:admin'], true)
  it('accepts full set and set without optional admin', () => {
    expect(validateAcceptedScopes(['openid', 'offline_access', 'mcp:tools', 'mcpwarden:admin'], offered).ok).toBe(true)
    expect(validateAcceptedScopes(['openid', 'offline_access', 'mcp:tools'], offered).ok).toBe(true)
  })
  it('rejects subsets without mcp:tools, unoffered scopes, and missing required', () => {
    expect(validateAcceptedScopes(['openid', 'offline_access'], offered).ok).toBe(false)
    expect(validateAcceptedScopes(['mcp:tools', 'other'], offered).ok).toBe(false)
    expect(validateAcceptedScopes(['mcp:tools'], offered).ok).toBe(false)
  })
  it('rejects empty, non-string and unoffered entries (falsy bypass)', () => {
    const o = buildConsentScopes(['openid', 'offline_access', 'mcp:tools'])
    for (const sel of [['', 'mcp:tools', 'mcpwarden:admin'], [undefined, 'mcp:tools'], [123], ['', 'openid', 'offline_access', 'mcp:tools'], ['openid', 'offline_access', 'mcp:tools', 'mcpwarden:admin']]) {
      expect(validateAcceptedScopes(sel, o).ok).toBe(false)
    }
  })
  it('does not echo attacker scope text and collapses duplicates', () => {
    const o = buildConsentScopes(['openid', 'offline_access', 'mcp:tools'])
    const bad = validateAcceptedScopes(['<script>x</script>'], o)
    expect(bad).toMatchObject({ ok: false })
    expect(JSON.stringify(bad)).not.toContain('script')
    expect(validateAcceptedScopes(['openid', 'openid', 'offline_access', 'mcp:tools', 'mcp:tools'], o)).toEqual({ ok: true, granted: ['openid', 'offline_access', 'mcp:tools'] })
  })
})

describe('buildConsentInfo', () => {
  it('builds the contract shape (loopback, allowlisted, resource)', () => {
    const info = buildConsentInfo({ client: claude, requestedScopes: ['openid', 'mcp:tools', 'mcpwarden:admin'], allowlist: BUILTIN_ALLOWLIST, baseUrl: base }) satisfies ConsentInfo
    expect(info).toEqual({
      client: {
        id: 'c1', name: 'Claude Code (x)', allowlisted: true, viaDcr: true, registeredAt: '2026-01-01T00:00:00.000Z',
        redirects: [{ uri: 'http://127.0.0.1:5/cb', host: '127.0.0.1:5', kind: 'loopback', loopback: true }],
      },
      scopes: [{ name: 'openid', required: true }, { name: 'mcp:tools', required: true }],
      resource: 'http://localhost:3000/mcp',
      loopback: true,
    })
  })
  it('marks unknown clients non-allowlisted, truncates untrusted names, and handles missing names', () => {
    const info = buildConsentInfo({
      client: { ...claude, name: 'Evil\n'.repeat(50), redirectUris: ['https://evil.example/cb'] },
      requestedScopes: ['mcp:tools'], allowlist: BUILTIN_ALLOWLIST, baseUrl: base,
    })
    expect(info.client.allowlisted).toBe(false)
    expect(info.client.name.length).toBeLessThanOrEqual(80)
    expect(info.loopback).toBe(false)
    expect(buildConsentInfo({ client: { ...claude, name: null }, requestedScopes: [], allowlist: [], baseUrl: base }).client.name).toBe('')
  })
  it('resource ignores any path of BASE_URL', () => {
    expect(buildConsentInfo({ client: claude, requestedScopes: [], allowlist: [], baseUrl: new URL('https://gw.example/x') }).resource).toBe('https://gw.example/mcp')
  })
})

describe('misc', () => {
  it('consentRedirect: app scheme and garbage are non-loopback', () => {
    expect(consentRedirect('cursor://x').loopback).toBe(false)
    expect(consentRedirect('evil-app://claude.ai')).toMatchObject({ host: 'evil-app://claude.ai', kind: 'app' })
    expect(consentRedirect('???').loopback).toBe(false)
    expect(consentRedirect('http://localhost:1/x').loopback).toBe(true)
  })
  it('parseScopeString dedups', () => {
    expect(parseScopeString('a  b a')).toEqual(['a', 'b'])
    expect(parseScopeString(undefined)).toEqual([])
  })
})
