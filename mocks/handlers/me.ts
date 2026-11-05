import type { Capabilities, ConnectionList, PatCreated, PatList } from '#shared/api-types'
import { getState, role, save, scenario } from '../state'
import { body, err, json, nid, noContent, route } from '../util'

export const meHandlers = [
  route('get', '/api/me/capabilities', () => {
    const s = getState()
    const caps: Capabilities = {
      mcpUrl: 'https://mcp.example.test/mcp', role: role(),
      stdio: role() === 'admin' && s.settings['stdio.enabled'] ? { allowed: true } : { allowed: false, reason: !s.settings['stdio.enabled'] ? 'instance_disabled' : 'not_granted' },
      limits: { maxUpstreams: 50, upstreamsUsed: s.upstreams.length, maxConnections: 20, callsPerMin: 120 },
      defaults: { ratePerMin: 60, maxConcurrent: 5, timeouts: { connectMs: 10_000, listMs: 15_000, callMs: 60_000 } },
      features: { healthHistory: false, toolMode: false, callLog: false },
    }
    return json(caps)
  }),
  route('get', '/api/me/pats', () => {
    const items = scenario() === 'empty' ? [] : getState().pats
    return json<PatList>({ items, limit: { max: 20, active: items.filter(p => !p.revokedAt).length } })
  }),
  route('post', '/api/me/pats', async ({ request }) => {
    const b = await body<{ name?: string }>(request)
    const name = (b.name ?? '').trim()
    if (!name || name.length > 64) return err(400, 'invalid_name', 'Der Name muss 1 bis 64 Zeichen lang sein.', 'name')
    const s = getState()
    if (s.pats.filter(p => !p.revokedAt).length >= 20) return err(409, 'pat_limit_reached', 'Du hast die Obergrenze von 20 aktiven Tokens erreicht.')
    const rnd = Math.random().toString(36).slice(2, 6)
    const token = `mcpw_pat_${rnd}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    const p = { id: nid('pat'), name, prefix: `mcpw_pat_${rnd}`, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null }
    s.pats.unshift(p); save() // Klartext nur in dieser Antwort, nicht im Zustand
    return json<PatCreated>({ ...p, token }, 201)
  }),
  route('delete', '/api/me/pats/:id', ({ params }) => {
    const p = getState().pats.find(x => x.id === params.id)
    if (!p) return err(404, 'not_found', 'Nicht gefunden.')
    p.revokedAt ??= new Date().toISOString(); save(); return noContent()
  }),
  route('get', '/api/me/connections', () => json<ConnectionList>({ items: scenario() === 'empty' ? [] : getState().connections })),
  route('delete', '/api/me/connections/:id', ({ params }) => {
    const s = getState()
    if (!s.connections.some(c => c.clientId === params.id)) return err(404, 'not_found', 'Nicht gefunden.')
    s.connections = s.connections.filter(c => c.clientId !== params.id); save(); return noContent()
  }),
]
