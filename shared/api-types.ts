/**
 * Geteilter Vertrag zwischen Frontend (app/**) und Backend (server/**).
 * Import überall als `#shared/api-types`.
 *
 * Regeln:
 * 1. Nur Typen und Konstanten; keine Laufzeitlogik, kein Import von Vue oder Nitro.
 * 2. Zeitstempel als ISO-8601-String, Zeitdauern in Millisekunden mit Suffix `Ms`,
 *    Anteile als Zahl 0 bis 1. Secrets kommen in keinem Antworttyp vor (nur `hasSecret: boolean`).
 * 3. Feld hinzufügen ist abwärtskompatibel und braucht nur den Hinweis im Commit-Betreff.
 *    Umbenennen oder Entfernen verlangt vorherige Absprache zwischen Frontend und dem
 *    Backend-Agenten der betroffenen Route und ändert Typ, Mock (Frontend) und Route im selben Commit.
 * 4. Wer eine Route baut oder ändert, ergänzt den Typ im selben Commit und prüft die Antwort
 *    mit `satisfies` gegen den Typ. Änderungen an der Datei tragen den Betreff-Präfix `contract:`.
 * 5. Das Backend baut keine Antwort, die vom Typ abweicht; weicht es bewusst ab, wird der Typ
 *    geändert (Regel 3), nicht die Abweichung verschwiegen.
 */

export type Role = 'admin' | 'user'

/** Nutzer in der Antwort von `GET /api/auth/get-session` (Teilmenge der Better-Auth-Felder). */
export interface AuthSessionUser {
  id: string
  name: string
  email: string
  role: Role
  banned: boolean
}

/** Fehlerform von Nitro (`createError`); `/api/auth/*` liefert stattdessen `AuthErrorBody`. */
export interface ApiErrorBody {
  statusCode: number
  statusMessage: string
  data?: { code?: string, field?: string, message?: string }
}

/** Fehlerform der Better-Auth-Endpunkte unter `/api/auth/*`. */
export interface AuthErrorBody {
  code?: string
  message: string
}

/** Stabiler Fehlercode (HTTP 403) von `POST /api/auth/sign-up/email`, wenn die Registrierung gesperrt ist. */
export const REGISTRATION_CLOSED = 'REGISTRATION_CLOSED'
