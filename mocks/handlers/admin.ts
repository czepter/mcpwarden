import type { AdminUserLimitsInput, AdminSettings, AdminSettingsResult, AllowlistInput, DcrMode } from '#shared/api-types'
import { DEFAULT_LIMITS } from '../seed'
import { getState, mailEnabled, save, scenario, volatileInviteTokens } from '../state'
import { body, err, json, nid, noContent, route } from '../util'

const A = { admin: true }
const METADATA = /^169\.254\./

export const adminHandlers = [
  route('get', '/api/admin/users', () => json({ items: scenario() === 'empty' ? getState().users.slice(0, 1) : getState().users, defaults: DEFAULT_LIMITS }), A),
  route('post', '/api/admin/users/:id/ban', ({ params }) => {
    const s = getState(); const u = s.users.find(x => x.id === params.id)
    if (!u) return err(404, 'not_found', 'Nicht gefunden.')
    if (u.role === 'admin') return err(409, u.id === 'usr_1' ? 'self_target' : 'last_admin', 'Dieses Konto kann nicht gesperrt werden.')
    u.banned = true; u.banReason = null; save(); return noContent()
  }, A),
  route('post', '/api/admin/users/:id/unban', ({ params }) => {
    const u = getState().users.find(x => x.id === params.id); if (!u) return err(404, 'not_found', 'Nicht gefunden.')
    u.banned = false; save(); return noContent()
  }, A),
  route('delete', '/api/admin/users/:id', ({ params }) => {
    const s = getState(); const u = s.users.find(x => x.id === params.id)
    if (!u) return err(404, 'not_found', 'Nicht gefunden.')
    if (u.role === 'admin') return err(409, 'self_target', 'Dieses Konto kann nicht gelöscht werden.')
    s.users = s.users.filter(x => x.id !== u.id); save(); return noContent()
  }, A),
  route('put', '/api/admin/users/:id/limits', async ({ params, request }) => {
    const u = getState().users.find(x => x.id === params.id); if (!u) return err(404, 'not_found', 'Nicht gefunden.')
    const b = await body<AdminUserLimitsInput>(request)
    for (const [k, v] of Object.entries(b)) {
      if (k === 'stdioAllowed') { u.stdioAllowed = Boolean(v); continue }
      if (!Number.isInteger(v) || (v as number) < 1) return err(422, 'validation', 'Ganze Zahl ab 1 erforderlich.', k)
      ;(u.limits as Record<string, number>)[k] = v as number
    }
    save(); return json(u)
  }, A),
  route('get', '/api/admin/invites', () => json({ items: getState().invites }), A),
  route('post', '/api/admin/invites', async ({ request }) => {
    const b = await body<{ email?: string, sendMail?: boolean }>(request)
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return err(422, 'validation', 'Ungültige E-Mail-Adresse.', 'email')
    if (b.sendMail) {
      if (!b.email) return err(422, 'validation', 'Für den Versand per E-Mail ist eine E-Mail-Adresse nötig.', 'sendMail')
      if (!mailEnabled()) return err(422, 'validation', 'E-Mail-Versand ist nicht eingerichtet.', 'sendMail')
    }
    const s = getState()
    const inv = { id: nid('inv'), email: b.email ?? null, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: 'open' as const, usedAt: null, usedByUserId: null, createdByUserId: 'usr_1' }
    s.invites.unshift(inv); save()
    const token = `inv-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    volatileInviteTokens.set(token, inv.id)
    return json({ id: inv.id, email: inv.email, createdAt: inv.createdAt, expiresAt: inv.expiresAt, link: `${location.origin}/invite/${token}`, mailQueued: b.sendMail === true }, 201)
  }, A),
  route('delete', '/api/admin/invites/:id', ({ params }) => {
    const inv = getState().invites.find(x => x.id === params.id)
    if (!inv) return err(404, 'not_found', 'Nicht gefunden.')
    if (inv.status !== 'open') return err(409, 'invite_not_open', 'Die Einladung ist nicht mehr offen.')
    inv.status = 'revoked'; save(); return noContent()
  }, A),
  route('get', '/api/admin/settings', () => {
    const s = getState()
    const warnings = s.settings['ssrf.allow'].filter(e => METADATA.test(e)).map(entry => ({ key: 'ssrf.allow', entry, code: 'covers_metadata_ip' as const }))
    return json<AdminSettingsResult>({ ...s.settings, warnings })
  }, A),
  route('put', '/api/admin/settings', async ({ request }) => {
    const b = await body<Partial<AdminSettings>>(request); const s = getState()
    if (b['ssrf.allow']) {
      const bad = b['ssrf.allow'].findIndex(e => !/^([0-9a-f:.]+\/\d{1,3}|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)$/.test(e))
      if (bad >= 0) return err(422, 'validation', 'Erwartet CIDR oder Hostname.', `ssrf.allow[${bad}]`)
      s.settings['ssrf.allow'] = b['ssrf.allow']
    }
    if (b['stdio.enabled'] !== undefined) s.settings['stdio.enabled'] = b['stdio.enabled']
    save()
    const warnings = s.settings['ssrf.allow'].filter(e => METADATA.test(e)).map(entry => ({ key: 'ssrf.allow', entry, code: 'covers_metadata_ip' as const }))
    return json<AdminSettingsResult>({ ...s.settings, warnings })
  }, A),
  // --- DCR (0b) ---
  route('get', '/api/admin/oauth/policy', () => json({ mode: getState().dcrMode }), A),
  route('put', '/api/admin/oauth/policy', async ({ request }) => {
    const b = await body<{ mode: DcrMode }>(request)
    if (!['off', 'allowlist', 'open'].includes(b.mode)) return err(400, 'invalid_mode', 'Ungültiger Modus.')
    getState().dcrMode = b.mode; save(); return json({ mode: b.mode })
  }, A),
  route('get', '/api/admin/oauth/allowlist', () => json({ items: getState().allowlist }), A),
  route('post', '/api/admin/oauth/allowlist', async ({ request }) => {
    const b = await body<AllowlistInput>(request)
    if (!b.label?.trim()) return err(400, 'invalid_entry', 'Bezeichnung fehlt.', 'label')
    if (!b.namePattern?.trim()) return err(400, 'invalid_entry', 'Name-Muster fehlt.', 'namePattern')
    if (!b.redirectPatterns?.length) return err(400, 'invalid_entry', 'Mindestens ein Redirect-Muster.', 'redirectPatterns')
    const e = { id: nid('al'), label: b.label, namePattern: b.namePattern, redirectPatterns: b.redirectPatterns, builtin: false, createdAt: new Date().toISOString() }
    getState().allowlist.push(e); save(); return json(e, 201)
  }, A),
  route('delete', '/api/admin/oauth/allowlist/:id', ({ params }) => {
    const s = getState(); if (!s.allowlist.some(x => x.id === params.id)) return err(404, 'not_found', 'Nicht gefunden.')
    s.allowlist = s.allowlist.filter(x => x.id !== params.id); save(); return noContent()
  }, A),
  route('post', '/api/admin/oauth/allowlist/reset-builtins', () => json({ items: getState().allowlist }), A),
  route('get', '/api/admin/oauth/clients', () => json({ items: scenario() === 'empty' ? [] : getState().oauthClients }), A),
  route('delete', '/api/admin/oauth/clients/:id', ({ params }) => {
    const s = getState(); if (!s.oauthClients.some(x => x.id === params.id)) return err(404, 'not_found', 'Nicht gefunden.')
    s.oauthClients = s.oauthClients.filter(x => x.id !== params.id); save(); return noContent()
  }, A),
]
