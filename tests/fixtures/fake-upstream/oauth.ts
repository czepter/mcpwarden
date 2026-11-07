import { createHash, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Minimal OAuth 2.1 authorization server + resource-server challenge for the fake upstream: protected resource metadata,
 * authorization server metadata, dynamic client registration, `/authorize` (answers with the redirect at once, like a user
 * who already agreed), `/token` (authorization code with PKCE S256 and refresh token with rotation).
 */
export type FakeOAuth = {
  /** Handles the OAuth endpoints; returns true if the request was one of them. */
  handle: (req: IncomingMessage, res: ServerResponse, origin: string) => Promise<boolean>
  /** true if the request carries the current access token. */
  authorized: (req: IncomingMessage) => boolean
  challenge: (res: ServerResponse, origin: string) => void
  /** The current access token stops working (a refresh still works). */
  expireAccess: () => void
  /** Refresh tokens stop working (the user has to reconnect). */
  revokeRefresh: () => void
  stats: { registrations: number, authorizes: number, tokenGrants: string[], redirectUris: string[] }
}

const form = async (req: IncomingMessage) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
const json = (res: ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))

export function createFakeOAuth(): FakeOAuth {
  const stats: FakeOAuth['stats'] = { registrations: 0, authorizes: 0, tokenGrants: [], redirectUris: [] }
  const codes = new Map<string, { challenge: string, redirectUri: string }>()
  let access = new Set<string>()
  let refresh = new Set<string>()
  const issue = () => {
    const a = `at-${randomUUID()}`
    const r = `rt-${randomUUID()}`
    access = new Set([a]) // only the newest access token is valid
    refresh.add(r)
    return { access_token: a, refresh_token: r, token_type: 'Bearer', expires_in: 3600 }
  }
  return {
    stats,
    authorized: req => access.has((req.headers.authorization ?? '').replace(/^Bearer /i, '')),
    challenge: (res, origin) => { res.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`, 'content-type': 'text/plain' }).end('unauthorized') },
    expireAccess: () => { access = new Set() },
    revokeRefresh: () => { refresh = new Set() },
    async handle(req, res, origin) {
      const url = new URL(req.url ?? '/', origin)
      const p = url.pathname
      if (p.startsWith('/.well-known/oauth-protected-resource')) {
        json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] })
        return true
      }
      if (p.startsWith('/.well-known/oauth-authorization-server') || p.startsWith('/.well-known/openid-configuration')) {
        json(res, 200, {
          issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`,
          response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
        return true
      }
      if (p === '/register' && req.method === 'POST') {
        const meta = JSON.parse(await form(req)) as { redirect_uris?: string[] }
        stats.registrations++
        stats.redirectUris.push(...(meta.redirect_uris ?? []))
        json(res, 201, { ...meta, client_id: `client-${stats.registrations}` })
        return true
      }
      if (p === '/authorize') {
        stats.authorizes++
        const redirectUri = url.searchParams.get('redirect_uri') ?? ''
        const code = `code-${randomUUID()}`
        codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri })
        const back = new URL(redirectUri)
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        res.writeHead(302, { location: back.href }).end()
        return true
      }
      if (p === '/token' && req.method === 'POST') {
        const f = new URLSearchParams(await form(req))
        const grant = f.get('grant_type') ?? ''
        stats.tokenGrants.push(grant)
        if (grant === 'authorization_code') {
          const c = codes.get(f.get('code') ?? '')
          codes.delete(f.get('code') ?? '')
          const challenge = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url')
          if (!c || c.challenge !== challenge) { json(res, 400, { error: 'invalid_grant' }); return true }
          json(res, 200, issue())
          return true
        }
        if (grant === 'refresh_token') {
          const r = f.get('refresh_token') ?? ''
          if (!refresh.has(r)) { json(res, 400, { error: 'invalid_grant' }); return true }
          refresh.delete(r) // rotation
          json(res, 200, issue())
          return true
        }
        json(res, 400, { error: 'unsupported_grant_type' })
        return true
      }
      return false
    },
  }
}
