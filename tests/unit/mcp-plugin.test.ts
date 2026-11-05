import { describe, expect, it } from 'vitest'
import { consentGuard, oauthRequestRewrite } from '../../server/auth/mcp-plugin'

const R = 'http://localhost:3000/mcp'

describe('oauthRequestRewrite', () => {
  it('adds mandatory scopes and the default resource on authorize (GET)', () => {
    const r = oauthRequestRewrite('/oauth2/authorize', { client_id: 'c', scope: 'mcp:tools' }, undefined, R)!
    expect(r.query).toMatchObject({ client_id: 'c', resource: R })
    expect((r.query!.scope as string).split(' ').sort()).toEqual(['mcp:tools', 'offline_access', 'openid'])
  })
  it('works for a missing scope and keeps an explicit resource', () => {
    const r = oauthRequestRewrite('/oauth2/authorize', { client_id: 'c', resource: 'http://x/y' }, undefined, R)!
    expect(r.query!.resource).toBe('http://x/y')
    expect(r.query!.scope).toBe('openid offline_access mcp:tools')
  })
  it('uses the body for POST authorize and token', () => {
    expect(oauthRequestRewrite('/oauth2/authorize', {}, { client_id: 'c' }, R)!.body).toMatchObject({ resource: R })
    expect(oauthRequestRewrite('/oauth2/token', {}, { grant_type: 'refresh_token' }, R)!.body).toEqual({ grant_type: 'refresh_token', resource: R })
  })
  it('ignores other paths', () => {
    expect(oauthRequestRewrite('/sign-in/email', {}, {}, R)).toBeUndefined()
  })
})

describe('consentGuard', () => {
  it('passes without scope (all requested) and for the full set', () => {
    expect(() => consentGuard('/oauth2/consent', { accept: true })).not.toThrow()
    expect(() => consentGuard('/oauth2/consent', { accept: true, scope: 'mcp:tools openid offline_access' })).not.toThrow()
    expect(() => consentGuard('/oauth2/consent', { accept: false, scope: 'openid' })).not.toThrow()
  })
  it('rejects subsets without a mandatory scope and unknown scopes', () => {
    expect(() => consentGuard('/oauth2/consent', { accept: true, scope: 'openid' })).toThrow()
    expect(() => consentGuard('/oauth2/consent', { accept: true, scope: 'mcp:tools' })).toThrow()
    expect(() => consentGuard('/oauth2/consent', { accept: true, scope: 'mcp:tools openid offline_access mcpwarden:admin' })).toThrow()
    expect(() => consentGuard('/oauth2/consent', { accept: true, scope: 42 })).toThrow()
  })
  it('ignores other paths', () => {
    expect(() => consentGuard('/oauth2/token', { accept: true, scope: 'x' })).not.toThrow()
  })
})
