import { describe, expect, it } from 'vitest'
import { checkOrigin, protectedResourceMetadata, resourceMetadataUrl, resourceUrl, wellKnownResponse } from '../../server/mcp/discovery'
import { forbidden, unauthorized } from '../../server/mcp/errors'

const base = new URL('http://localhost:3000')
const cfg = { baseUrl: base, allowedOrigins: ['http://localhost:3000', 'https://app.example'] }
const req = (headers: Record<string, string> = {}, method = 'POST') => new Request('http://localhost:3000/mcp', { method, headers })

describe('errors', () => {
  it('401 without token has resource_metadata but no error code', async () => {
    const res = unauthorized('http://localhost:3000/.well-known/oauth-protected-resource/mcp')
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe('Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"')
    expect((await res.json()).error).toBe('unauthorized')
  })
  it('401 with invalid token adds error and sanitizes quotes', () => {
    const res = unauthorized('http://x/prm', { error: 'invalid_token', description: 'bad "aud"' })
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"')
    expect(res.headers.get('www-authenticate')).toContain('error_description="bad aud"')
  })
  it('403 insufficient_scope', () => {
    const res = forbidden('http://x/prm')
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toContain('error="insufficient_scope"')
  })
})

describe('discovery', () => {
  it('urls derive from BASE_URL', () => {
    expect(resourceUrl(base)).toBe('http://localhost:3000/mcp')
    expect(resourceMetadataUrl(base)).toBe('http://localhost:3000/.well-known/oauth-protected-resource/mcp')
  })
  it('protected resource metadata', () => {
    expect(protectedResourceMetadata(base, 'http://localhost:3000/api/auth')).toEqual({
      resource: 'http://localhost:3000/mcp',
      authorization_servers: ['http://localhost:3000/api/auth'],
      scopes_supported: ['openid', 'offline_access', 'mcp:tools'],
      bearer_methods_supported: ['header'],
      resource_name: 'mcpwarden',
    })
  })
  it('well-known response: json + cors, options, other methods', async () => {
    const ok = wellKnownResponse(new Request('http://localhost:3000/x'), { a: 1 })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('application/json')
    expect(ok.headers.get('access-control-allow-origin')).toBe('*')
    expect(await ok.json()).toEqual({ a: 1 })
    expect(wellKnownResponse(new Request('http://localhost:3000/x', { method: 'OPTIONS' }), {}).status).toBe(204)
    expect(wellKnownResponse(new Request('http://localhost:3000/x', { method: 'POST' }), {}).status).toBe(405)
  })
})

describe('checkOrigin', () => {
  it('passes without Origin (CLI clients)', () => {
    expect(checkOrigin(req({ host: 'localhost:3000' }), cfg)).toBeUndefined()
  })
  it('passes allowed origins (port-agnostic hostnames)', () => {
    expect(checkOrigin(req({ host: 'localhost:3000', origin: 'http://localhost:3000' }), cfg)).toBeUndefined()
    expect(checkOrigin(req({ host: 'localhost:3000', origin: 'https://app.example' }), cfg)).toBeUndefined()
  })
  it('rejects foreign, null and garbage origins with 403', () => {
    for (const origin of ['https://evil.example', 'null', 'not a url']) {
      expect(checkOrigin(req({ host: 'localhost:3000', origin }), cfg)?.status).toBe(403)
    }
  })
  it('rejects a foreign Host header (DNS rebinding)', () => {
    expect(checkOrigin(req({ host: 'evil.example' }), cfg)?.status).toBe(403)
  })
})
