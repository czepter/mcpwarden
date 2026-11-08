import type { ConsentInfo } from '#shared/api-types'
import { err, json, noContent, route } from '../util'

export const oauthHandlers = [
  route('get', '/api/oauth/consent-info', ({ request }) => {
    const u = new URL(request.url)
    const id = u.searchParams.get('client_id') ?? 'agent-x'
    if (u.searchParams.get('sig') === 'bad' || id === 'bad-sig') return err(400, 'invalid_consent_query', 'Die Anfrage ist nicht gültig oder abgelaufen.')
    const known = id === 'claude-code'
    const loopback = id === 'agent-loopback'
    const info: ConsentInfo = {
      client: {
        id, name: known ? 'Claude Code' : loopback ? 'Lokaler Agent' : 'agent.example.org',
        redirects: [loopback ? { uri: 'http://localhost:8123/cb', host: 'localhost', kind: 'loopback', loopback: true } : known ? { uri: 'http://localhost:33418/callback', host: 'localhost', kind: 'loopback', loopback: true } : { uri: 'https://agent.example.org/oauth/cb', host: 'agent.example.org', kind: 'web', loopback: false }],
        allowlisted: known, registeredAt: new Date(Date.now() - 120_000).toISOString(), viaDcr: true,
      },
      // Client 'agent-admin': phase 2 server that already offers the admin scope (the UI hides it until then).
      scopes: [{ name: 'mcp:tools', required: true }, { name: 'openid', required: true }, { name: 'offline_access', required: true }, ...(id === 'agent-admin' ? [{ name: 'mcpwarden:admin', required: false }] : [])],
      resource: 'https://mcp.example.test/mcp', loopback: known || loopback,
      suggestedDeviceName: 'Mac · Safari',
    }
    return json(info)
  }),
  // Device grant (RFC 8628 verification). Codes: ZZZZZZZZ invalid, EEEEEEEE expired, OOOOOOOO claimed by another account; anything else is pending.
  route('get', '/api/auth/device', ({ request }) => {
    const c = new URL(request.url).searchParams.get('user_code') ?? ''
    if (c === 'ZZZZZZZZ') return json({ error: 'invalid_request', error_description: 'Invalid user code' }, 400)
    if (c === 'EEEEEEEE') return json({ error: 'expired_token', error_description: 'User code has expired' }, 400)
    if (c === 'OOOOOOOO') return json({ user_code: c, status: 'pending' })
    return json({ user_code: c, status: 'pending', client_id: 'mcpwarden-cli', scope: 'openid offline_access mcp:tools', resource: 'https://mcp.example.test/mcp' })
  }),
  route('post', '/api/auth/device/approve', () => json({ success: true })),
  route('post', '/api/auth/device/deny', () => json({ success: true })),
  route('post', '/api/oauth/consent-device', () => noContent()),
  route('post', '/api/auth/oauth2/consent', async ({ request }) => {
    const b = await request.json().catch(() => ({})) as { accept?: boolean }
    return json({ redirectURI: b.accept ? '/consent?done=granted' : '/consent?done=denied' })
  }),
]
