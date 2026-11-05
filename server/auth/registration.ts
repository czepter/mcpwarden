import { INVITE_INVALID, INVITE_REQUIRED, REGISTRATION_CLOSED } from '../../shared/api-types'

export type RegistrationDecision = { ok: true } | { ok: false, code: string }

/** Prüft eine Einladung, ohne sie zu verbrauchen (der Verbrauch ist atomar beim Anlegen des Nutzers). */
export type InviteCheck = (token: string, email: string) => Promise<boolean>

/**
 * Die eine Stelle der Registrierungssperre. Der erste Nutzer registriert sich ohne Token (Rolle admin);
 * danach ist ein gültiger Einladungs-Token (Header `X-Invite-Token`) Pflicht. Ohne Einladungsprüfung
 * (Schema-CLI, Tests ohne DB) bleibt die Registrierung nach dem ersten Nutzer geschlossen.
 */
export async function canRegister(
  ctx: { email: string, inviteToken?: string },
  countUsers: () => Promise<number>,
  checkInvite?: InviteCheck,
): Promise<RegistrationDecision> {
  if ((await countUsers()) === 0) return { ok: true }
  if (!checkInvite) return { ok: false, code: REGISTRATION_CLOSED }
  if (!ctx.inviteToken) return { ok: false, code: INVITE_REQUIRED }
  return (await checkInvite(ctx.inviteToken, ctx.email)) ? { ok: true } : { ok: false, code: INVITE_INVALID }
}
