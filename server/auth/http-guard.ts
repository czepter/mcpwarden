/**
 * Better-Auth-Endpunkte, die per HTTP (`/api/auth/**`) nie erreichbar sind. Sie umgehen mcpwarden-Pruefungen:
 *  - `/admin/**` (admin()-Plugin): Impersonation, Passwort/Rolle setzen, Nutzer anlegen/aendern/loeschen/sperren umgehen
 *    `guardTarget` (letzter Admin, Selbstziel), die Aufraeum-Handler (Pool, Worker, Tokens) und das Audit.
 *  - Client-Verwaltung des OAuth-Providers (`create-client`, `update-client`, ...): umgeht die DCR-Policy (nur `/oauth2/register`
 *    ist gegated) und die Client-Verwaltung unter `/api/admin/oauth/**`.
 * Erlaubt bleiben ausschliesslich serverseitige Aufrufe (`auth.api.*` ohne Request, siehe server/gateway/auth-admin.ts).
 */
const BLOCKED: RegExp[] = [
  /^\/admin(\/|$)/,
  /^\/oauth2\/(create-client|update-client|delete-client|update-consent|delete-consent)$/,
  /^\/oauth2\/client\/rotate-secret$/,
]

/** `path` ist der Endpunktpfad relativ zum basePath (z. B. `/admin/ban-user`). */
export function isBlockedOverHttp(path: string): boolean {
  const p = path.toLowerCase().replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
  return BLOCKED.some(r => r.test(p))
}
