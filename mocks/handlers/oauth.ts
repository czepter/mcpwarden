import type { ConsentInfo } from '#shared/api-types'
import { err, json, route } from '../util'

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
        redirects: [loopback ? { uri: 'http://localhost:8123/cb', host: 'localhost', loopback: true } : known ? { uri: 'http://localhost:33418/callback', host: 'localhost', loopback: true } : { uri: 'https://agent.example.org/oauth/cb', host: 'agent.example.org', loopback: false }],
        allowlisted: known, registeredAt: new Date(Date.now() - 120_000).toISOString(), viaDcr: true,
      },
      scopes: [{ name: 'mcp:tools', required: true }, { name: 'openid', required: true }, { name: 'offline_access', required: true }],
      resource: 'https://mcp.example.test/mcp', loopback: known || loopback,
    }
    return json(info)
  }),
  route('post', '/api/auth/oauth2/consent', async ({ request }) => {
    const b = await request.json().catch(() => ({})) as { accept?: boolean }
    return json({ redirectURI: b.accept ? '/consent?done=granted' : '/consent?done=denied' })
  }),
]
