import { INVITE_INVALID, INVITE_REQUIRED, REGISTRATION_CLOSED } from '../../shared/api-types'

export type RegistrationDecision = { ok: true } | { ok: false, code: string }

/** Checks an invitation without consuming it (consumption is atomic when the user is created). */
export type InviteCheck = (token: string, email: string) => Promise<boolean>

/**
 * The single place of the registration lock. The first user registers without a token (role admin);
 * after that a valid invitation token (header `X-Invite-Token`) is required. Without an invitation check
 * (schema CLI, tests without DB) registration stays closed after the first user.
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
