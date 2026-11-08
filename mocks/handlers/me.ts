import type { Capabilities, ConnectionList, MeSettings, PatCreated, PatList, PatSummary } from '#shared/api-types'
import { currentUser, getState, role, save, scenario, stdioReasonOverride } from '../state'
import { body, err, json, nid, noContent, route } from '../util'

function mySettings(): MeSettings {
  const s = getState()
  return { notifyStatusMail: s.notifyStatusMail ?? true, notifyNewClient: s.notifyNewClient ?? true, notifyWeekly: s.notifyWeekly ?? false, toolMode: s.toolMode ?? 'direct', theme: s.theme ?? 'system' }
}

export const meHandlers = [
  route('get', '/api/me/capabilities', () => {
    const s = getState()
    const caps: Capabilities = {
      mcpUrl: 'https://mcp.example.test/mcp', role: role(),
      stdio: stdioReasonOverride() ? { allowed: false, reason: stdioReasonOverride()! } : role() === 'admin' && s.settings['stdio.enabled'] ? { allowed: true } : { allowed: false, reason: !s.settings['stdio.enabled'] ? 'instance_disabled' : 'not_granted' },
      limits: { maxUpstreams: 50, upstreamsUsed: s.upstreams.length, maxConnections: 20, callsPerMin: 120 },
      defaults: { ratePerMin: 60, maxConcurrent: 5, timeouts: { connectMs: 10_000, listMs: 15_000, callMs: 60_000 } },
      features: { healthHistory: true, toolMode: true, callLog: false },
    }
    return json(caps)
  }),
  route('get', '/api/me/settings', () => json<MeSettings>(mySettings())),
  route('patch', '/api/me/settings', async ({ request }) => {
    const b = await body<Record<string, unknown>>(request)
    const unknown = Object.keys(b).find(k => !['notifyStatusMail', 'notifyNewClient', 'notifyWeekly', 'toolMode', 'theme'].includes(k))
    if (unknown) return err(422, 'validation', 'Unbekanntes Feld', unknown)
    for (const k of ['notifyStatusMail', 'notifyNewClient', 'notifyWeekly']) if (b[k] !== undefined && typeof b[k] !== 'boolean') return err(422, 'validation', `${k} muss true oder false sein`, k)
    if (b.toolMode !== undefined && b.toolMode !== 'direct' && b.toolMode !== 'meta') return err(422, 'validation', 'toolMode muss direct oder meta sein', 'toolMode')
    if (b.theme !== undefined && !['system', 'light', 'dark'].includes(b.theme as string)) return err(422, 'validation', 'theme muss system, light oder dark sein', 'theme')
    const s = getState()
    if (typeof b.notifyStatusMail === 'boolean') s.notifyStatusMail = b.notifyStatusMail
    if (typeof b.notifyNewClient === 'boolean') s.notifyNewClient = b.notifyNewClient
    if (typeof b.notifyWeekly === 'boolean') s.notifyWeekly = b.notifyWeekly
    if (b.toolMode === 'direct' || b.toolMode === 'meta') s.toolMode = b.toolMode
    if (b.theme === 'system' || b.theme === 'light' || b.theme === 'dark') s.theme = b.theme
    save()
    return json<MeSettings>(mySettings())
  }),
  // Self-deletion: wrong password -> 403, the last admin cannot go; afterwards the mock session is signed out.
  route('delete', '/api/me', async ({ request }) => {
    const b = await body<{ password?: string, confirmEmail?: string }>(request)
    const s = getState()
    const me = currentUser()
    if (!b.password || !b.confirmEmail || b.confirmEmail.trim().toLowerCase() !== me.email.toLowerCase()) return err(422, 'validation', 'Die E-Mail-Adresse stimmt nicht überein.', 'confirmEmail')
    if (b.password === 'wrong') return err(403, 'invalid_password', 'Das Passwort ist falsch.', 'password')
    if (role() === 'admin' && s.users.filter(u => u.role === 'admin' && !u.banned).length <= 1) return err(409, 'last_admin', 'Der letzte aktive Admin kann sein Konto nicht löschen.')
    s.signedIn = false; save(); return noContent()
  }),
  route('get', '/api/me/pats', () => {
    const items = scenario() === 'empty' ? [] : getState().pats
    return json<PatList>({ items, limit: { max: 20, active: items.filter(p => !p.revokedAt).length } })
  }),
  route('post', '/api/me/pats', async ({ request }) => {
    const b = await body<{ name?: string, expiresInDays?: number | null, upstreamIds?: string[] | null, deviceName?: string | null }>(request)
    const name = (b.name ?? '').trim()
    if (!name || name.length > 64) return err(400, 'invalid_name', 'Der Name muss 1 bis 64 Zeichen lang sein.', 'name')
    const deviceName = (b.deviceName ?? '').trim() || null
    if (deviceName && deviceName.length > 64) return err(400, 'invalid_device_name', 'Der Gerätename darf höchstens 64 Zeichen lang sein.', 'deviceName')
    const s = getState()
    if (s.pats.filter(p => !p.revokedAt).length >= 20) return err(409, 'pat_limit_reached', 'Du hast die Obergrenze von 20 aktiven Tokens erreicht.')
    const rnd = Math.random().toString(36).slice(2, 6)
    const token = `mcpw_pat_${rnd}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    const expiresAt = b.expiresInDays ? new Date(Date.now() + b.expiresInDays * 86_400_000).toISOString() : null
    const p: PatSummary = { id: nid('pat'), name, deviceName, prefix: `mcpw_pat_${rnd}`, createdAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null, expiresAt, upstreamIds: b.upstreamIds ?? null }
    s.pats.unshift(p); save() // plaintext only in this response, not in the state
    return json<PatCreated>({ ...p, token }, 201)
  }),
  route('delete', '/api/me/pats/:id', ({ params }) => {
    const p = getState().pats.find(x => x.id === params.id)
    if (!p) return err(404, 'not_found', 'Nicht gefunden.')
    p.revokedAt ??= new Date().toISOString(); save(); return noContent()
  }),
  route('patch', '/api/me/pats/:id', async ({ params, request }) => {
    const p = getState().pats.find(x => x.id === params.id)
    if (!p) return err(404, 'not_found', 'Nicht gefunden.')
    const b = await body<{ deviceName?: string | null }>(request)
    const name = (b.deviceName ?? '').trim() || null
    if (name && name.length > 64) return err(400, 'invalid_device_name', 'Der Gerätename darf höchstens 64 Zeichen lang sein.', 'deviceName')
    p.deviceName = name; save(); return noContent()
  }),
  route('patch', '/api/me/connections/:id', async ({ params, request }) => {
    const c = getState().connections.find(x => x.clientId === params.id)
    if (!c) return err(404, 'not_found', 'Nicht gefunden.')
    const b = await body<{ deviceName?: string | null }>(request)
    const name = (b.deviceName ?? '').trim() || null
    if (name && name.length > 64) return err(400, 'invalid_device_name', 'Der Gerätename darf höchstens 64 Zeichen lang sein.', 'deviceName')
    c.deviceName = name; save(); return noContent()
  }),
  route('get', '/api/me/connections', () => json<ConnectionList>({ items: scenario() === 'empty' ? [] : getState().connections })),
  route('delete', '/api/me/connections/:id', ({ params }) => {
    const s = getState()
    if (!s.connections.some(c => c.clientId === params.id)) return err(404, 'not_found', 'Nicht gefunden.')
    s.connections = s.connections.filter(c => c.clientId !== params.id); save(); return noContent()
  }),
]
