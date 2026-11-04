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

// --- Phase 0b: OAuth-Provider, Consent, PATs, Clients (docs/plans/phase-0b.md, Abschnitt 4.1) ---

/** Ein Fehlerkörper der eigenen Routen (h3 `createError`), Form nach Plan 0b E19. */
export type ApiErrorBody = {
  statusCode: number
  statusMessage?: string
  data?: { code?: string, field?: string, message?: string }
}

export type DcrMode = 'off' | 'allowlist' | 'open'
export type DcrPolicy = { mode: DcrMode } // Standard 'open'

// Consent: Name, Redirect-URIs, Allowlist-Status, Scopes (ohne Titel, Titel stehen im Frontend)
export type ConsentRedirect = { uri: string, host: string, loopback: boolean }
export type ConsentScope = { name: string, required: boolean }
export type ConsentInfo = {
  client: {
    id: string
    name: string // untrusted, auf 80 Zeichen gekürzt, nur als Text rendern
    redirects: ConsentRedirect[]
    allowlisted: boolean // live gegen die aktuelle Allowlist berechnet
    registeredAt: string
    viaDcr: boolean
  }
  scopes: ConsentScope[] // 'mcpwarden:admin' nur, wenn aktiviert (in 0b nie)
  resource: string // BASE_URL + '/mcp'
  loopback: boolean // mindestens eine Redirect-URI ist Loopback (Zusatzwarnung)
}

// PATs: Klartext nur in PatCreated.token
export type PatSummary = {
  id: string
  name: string
  prefix: string // 'mcpw_pat_' + 4 Zeichen
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}
export type PatList = { items: PatSummary[], limit: { max: number, active: number } } // max = 20
export type PatCreated = PatSummary & { token: string }
export type PatCreateInput = { name: string } // 1 bis 64 Zeichen

// Clients des Nutzers (UI-Wort "Clients", Pfad bleibt "connections")
export type ConnectionSummary = {
  clientId: string
  name: string
  scopes: string[]
  redirectHost: string
  allowlisted: boolean
  grantedAt: string
  lastUsedAt: string | null // letzter Aufruf auf /mcp, gedrosselt auf 1 min genau
  active: boolean // lastUsedAt höchstens 5 min her; Anzeige "Aktiv"/"Inaktiv" im Frontend
}
export type ConnectionList = { items: ConnectionSummary[] }

// Admin: Allowlist und Registrierungen
export type AllowlistEntry = {
  id: string
  label: string
  namePattern: string
  redirectPatterns: string[]
  builtin: boolean
  createdAt: string
}
export type AllowlistInput = Pick<AllowlistEntry, 'label' | 'namePattern' | 'redirectPatterns'>
export type AllowlistList = { items: AllowlistEntry[] }
export type OAuthClientAdmin = {
  id: string
  name: string
  redirectUris: string[]
  createdAt: string
  lastUsedAt: string | null
  userCount: number // Anzahl Consents
  allowlisted: boolean // live berechnet
  registeredVia: 'dcr' | 'admin'
  disabled: boolean
  expiresAt: string | null // createdAt + 30 Tage, solange nie genutzt; sonst null
}
export type OAuthClientAdminList = { items: OAuthClientAdmin[] }
