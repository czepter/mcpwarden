import type { AuthSession, InviteInfo, PublicConfig } from '#shared/api-types'
import { INVITE_INVALID, INVITE_REQUIRED } from '#shared/api-types'
import { SEED_INVITE_TOKENS } from '../seed'
import { currentUser, getState, mailEnabled, registrationOpen, role, save, volatileInviteTokens } from '../state'
import { body, err, json, nid, noContent, route } from '../util'
import { HttpResponse } from 'msw'

/** Better-Auth-Fehlerform (`AuthErrorBody`) wie vom echten Backend unter `/api/auth/*`. */
const authErr = (status: number, code: string, message: string) => HttpResponse.json({ code, message }, { status })

export function inviteState(token: string): InviteInfo {
  const s = getState()
  const key = SEED_INVITE_TOKENS[token] ?? volatileInviteTokens.get(token)
  if (!key) return { valid: false, reason: 'unknown' }
  if (key === 'expired') return { valid: false, reason: 'expired' }
  if (key === 'used') return { valid: false, reason: 'used' }
  const inv = s.invites.find(i => i.id === key)
  if (!inv) return { valid: false, reason: 'unknown' }
  if (inv.status === 'revoked') return { valid: false, reason: 'revoked' }
  if (inv.status === 'used') return { valid: false, reason: 'used' }
  return { valid: true, email: inv.email, expiresAt: inv.expiresAt }
}

export const authHandlers = [
  route('get', '/api/auth/get-session', () => {
    const s = getState()
    if (!s.signedIn) return json<AuthSession>(null)
    const u = currentUser()
    return json<AuthSession>({ user: { id: u.id, name: u.name, email: u.email, role: role(), banned: false }, session: { id: 's1', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } })
  }, { public: true }),
  route('post', '/api/auth/sign-in/email', async ({ request }) => {
    const b = await body<{ email?: string, password?: string }>(request)
    if (!b.email || !b.password || b.password === 'falsch') return err(401, 'invalid_credentials', 'E-Mail oder Passwort stimmt nicht.')
    if (b.email.startsWith('gesperrt@')) return err(403, 'banned', 'Dieses Konto ist gesperrt.')
    getState().signedIn = true; save()
    return json({ ok: true })
  }, { public: true }),
  route('post', '/api/auth/sign-up/email', async ({ request }) => {
    const token = request.headers.get('x-invite-token')
    if (!token) return authErr(403, INVITE_REQUIRED, 'Registrierung nur mit Einladung.')
    const st = inviteState(token)
    if (!st.valid) return authErr(403, INVITE_INVALID, 'Die Einladung ist ungültig oder abgelaufen.')
    const b = await body<{ name: string, email: string, password?: string }>(request)
    if ((b.password ?? '').length < 12) return err(422, 'validation', 'Mindestens 12 Zeichen.', 'password')
    if (st.email && st.email !== b.email) return authErr(403, INVITE_INVALID, 'Die Einladung gilt für eine andere E-Mail-Adresse.')
    const s = getState()
    const key = SEED_INVITE_TOKENS[token] ?? volatileInviteTokens.get(token)
    const inv = s.invites.find(i => i.id === key)
    if (inv) { inv.status = 'used'; inv.usedAt = new Date().toISOString() }
    s.signedIn = true; save()
    return json({ ok: true })
  }, { public: true }),
  route('post', '/api/auth/sign-out', () => { getState().signedIn = false; save(); return json({ ok: true }) }, { public: true }),
  route('post', '/api/auth/update-user', async ({ request }) => {
    const b = await body<{ name: string }>(request)
    if (!b.name?.trim()) return err(422, 'validation', 'Der Name darf nicht leer sein.', 'name')
    currentUser().name = b.name.trim(); save(); return json({ ok: true })
  }),
  route('post', '/api/auth/change-password', async ({ request }) => {
    const b = await body<{ currentPassword: string, newPassword: string }>(request)
    if (b.currentPassword === 'falsch') return err(400, 'invalid_password', 'Das aktuelle Passwort stimmt nicht.', 'currentPassword')
    if ((b.newPassword ?? '').length < 12) return err(422, 'validation', 'Mindestens 12 Zeichen.', 'newPassword')
    return json({ ok: true })
  }),
  route('get', '/api/auth/list-sessions', () => json([
    { id: 'ses_1', token: 'tok-a', userAgent: 'Safari auf macOS', ipAddress: '192.0.2.10', createdAt: new Date(Date.now() - 3_600_000).toISOString(), current: true },
    { id: 'ses_2', token: 'tok-b', userAgent: 'Firefox auf Linux', ipAddress: '192.0.2.44', createdAt: new Date(Date.now() - 86_400_000 * 2).toISOString(), current: false },
  ])),
  route('post', '/api/auth/revoke-session', () => json({ ok: true })),
  route('get', '/api/public-config', () => json<PublicConfig>({ mail: mailEnabled(), registrationOpen: registrationOpen() }), { public: true }),
  // Wie Better Auth: gleiche Antwort fuer jede Adresse (keine Kontoenumeration); ohne Mail 400 RESET_PASSWORD_DISABLED.
  route('post', '/api/auth/request-password-reset', async ({ request }) => {
    if (!mailEnabled()) return err(400, 'RESET_PASSWORD_DISABLED', 'Reset password isn\'t enabled')
    const b = await body<{ email?: string }>(request)
    if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return err(400, 'VALIDATION_ERROR', 'Invalid email')
    return json({ status: true, message: 'If this email exists in our system, check your email for the reset link' })
  }, { public: true }),
  // Mock: nur das Token `abgelaufen` ist ungueltig; er merkt sich keine Tokens.
  route('post', '/api/auth/reset-password', async ({ request }) => {
    const b = await body<{ token?: string, newPassword?: string }>(request)
    if (!b.token || b.token === 'abgelaufen') return err(400, 'INVALID_TOKEN', 'Invalid token')
    if ((b.newPassword ?? '').length < 12) return err(400, 'PASSWORD_TOO_SHORT', 'Password too short', 'password')
    return json({ status: true })
  }, { public: true }),
  route('get', '/api/invites/:token', ({ params }) => json(inviteState(String(params.token))), { public: true }),
]
export { nid, noContent }
