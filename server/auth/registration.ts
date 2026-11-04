import { REGISTRATION_CLOSED } from '../../shared/api-types'

export type RegistrationDecision = { ok: true } | { ok: false, code: string }

/**
 * Die eine Stelle der Registrierungssperre. 0a: nur der erste Nutzer darf sich registrieren.
 * Phase 1 ersetzt den Inhalt durch die Token-Einladung (`inviteToken`); Hook und Mutex bleiben.
 */
export async function canRegister(
  _ctx: { email: string, inviteToken?: string },
  countUsers: () => Promise<number>,
): Promise<RegistrationDecision> {
  return (await countUsers()) === 0 ? { ok: true } : { ok: false, code: REGISTRATION_CLOSED }
}
