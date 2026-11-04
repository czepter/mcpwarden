# Phase 1 (Kern) — Umsetzungsplan

Stand: 2026-11-04 · Basis: `docs/spec.md` v0.3 (Änderungen für v0.4 in Abschnitt 2), `docs/ui-abgleich.md`, `docs/plans/frontend.md` · Status: überarbeitet nach `docs/plans/review.md` und den bestätigten Entscheidungen E13 bis E18, Entwurf zur Freigabe
Umfang laut Spec: P0-1 bis P0-7, P0-9 bis P0-11 (Gateway, stdio + HTTP-Upstreams, Bearer/Header-Auth, Tool-Filter, SSRF, Docker, Persistenz inkl. Rate-Limit pro Upstream und Worker-pro-Nutzer mit Supervisor). Tokens/Login/Consent kommen als Voraussetzung aus 0a/0b.
Dazu: **P0-4 Admin-Funktionen** (Einladung per Token-Link, Nutzer sperren/löschen, `requireAdmin`-Routen; Befund B2, in Meilenstein 1.1), der **Umstiegstest PGlite → Postgres** (P0-11, Befund B4, Aufgabe 1.4.3), Mindestteile aus P0-14/P0-15 (Entscheidung E3) und die Lese-Routen `GET /api/dashboard` (ohne KPIs) und `GET /api/audit` (E16). Nicht in Phase 1: P0-8 REST-Tools, P0-12 Verwaltungs-Tools, P0-13 Upstream-OAuth, Routing, Profile, Import, Poisoning-Prüfung, Statistik und KPIs (Phase 2), Mail-Funktionen, Selbstlöschung.

**Zuständigkeit (E13):** Phase 1 liefert ausschließlich `server/**`, `supervisor/**`, `tools/**`, Tests und Beiträge zum Vertrag `shared/api-types.ts`. **Alle Vue-Dateien unter `app/**` gehören dem Frontend** (`docs/plans/frontend.md`). Wo dieser Plan früher Seiten und Komponenten nannte, steht jetzt die API-Seite; welche Routen das Frontend je Bildschirm braucht, steht in Abschnitt 4.5.

## 0. Entscheidungen für den Reviewer

Quelle der Antworten: Abschnitt „Empfehlungen zu den Entscheidungen" und Abgleichtabelle in `review.md`. „Übernommen" = Review-Empfehlung eingearbeitet, kein Nutzerentscheid nötig. „bestätigt 2026-11-04" = Entscheidung liegt beim Nutzer, Plan arbeitet mit der Annahme.

| Nr | Entscheidung | Antwort / Stand |
|----|--------------|-----------------|
| E1 | SDK-Linie | **v2** (`@modelcontextprotocol/server`/`client` 2.4.0, `@modelcontextprotocol/node` 2.1.2). Übernommen. Nötige Optionen sind in den Typen belegt (`fetch` an den Client-Transporten, `signal`/`timeout`/`maxTotalTimeout` in `RequestOptions`). Spec-Text „SDK" wird in v0.4 angepasst. |
| E2 | Sessions / `list_changed` (P0-1 „Session-ID im Header", P0-5) | **bestätigt 2026-11-04:** Gateway zustandslos (Spec 2026-07-28, `legacy: 'stateless'`). 2026er-Clients bekommen `tools/list_changed` per `subscriptions/listen` (Aufgabe 1.2.8, mandantengetrennt). 2025er-Clients: kein Push, sie sehen Änderungen beim nächsten `tools/list`; Sicherheit hängt nie am Push (jeder `tools/call` prüft serverseitig). Sessionful-Legacy nur, wenn ein Zielclient es nachweislich braucht. Spec P0-1/P0-5 in v0.4 anpassen. |
| E3 | Mindestumfang P0-14/P0-15 | Übernommen, Tabelle Abschnitt 6. Spec-Phasen in v0.4 nachziehen (B18). |
| E4 | Wo werden Upstream-Secrets entschlüsselt? | **Web-App.** Übernommen. Env-Secrets für stdio gehen (je nach E10) direkt Web-App → Worker und passieren den Root-Supervisor nicht. Supervisor kennt weder `MASTER_KEY` noch DB. Spec P0-5 in v0.4 anpassen. |
| E5 | Prozessstruktur | **Ein Container**, Supervisor (Root, 3 Capabilities) startet die Web-App per `spawn` unter unprivilegierter UID. Übernommen, mit den Härtungen aus 4.1 (UID-Ableitung im Supervisor, getrennte Verzeichnisbäume, kein Frame-Parsing im Root-Prozess). |
| E6 | `slim` vs `full` | **`slim`**: ohne Supervisor-Bundle, ohne `uv`/`uvx`, stdio fest aus (nicht nur Voreinstellung); Image startet die Web-App direkt als `USER web`. **`full`**: Supervisor als Entrypoint, `uv`/`uvx`, `STDIO_MODE` Standard `auto`. Beide mit Node. Übernommen. |
| E7 | Zusätzliche ENV-Variablen | Nur **`STDIO_MODE`** (`off`\|`auto`) und **`TRUST_PROXY`**; dazu der Test-Schalter für Rate-Limits, den 0a festlegt (B16). Socket-Pfad (`/run/mcpwarden/sup.sock`) und Web-UID/GID (10001) sind Konstanten im Image, keine ENV. Übernommen. Spec P0-10 um die Liste ergänzen (v0.4). |
| E8 | Neue Tools eines Upstreams standardmäßig aktiv? | Ja. Übernommen. Rug-Pull-Schutz folgt mit der Poisoning-Prüfung (P1). |
| E9 | `audit_log` | **Phase 1 legt `audit_log` und `audit()` an** (Aufgabe 1.1.3), da 0b Audit ausdrücklich ausschließt. Übernommen. |
| E10 | Datenpfad Web-App ↔ Worker (B8) | **Ziel:** Der Supervisor reicht pro Worker die angenommene Socket-Verbindung der Web-App als zusätzlichen Stdio-Deskriptor an den Worker durch; danach fließen Frames direkt Web-App ↔ Worker, der Root-Supervisor sieht keine MCP-Daten. **Fallback** (falls der Spike 1.3.0 scheitert): Supervisor kopiert Bytes ohne Parsing zwischen Socket und Worker-Pipe (roher Pipe, keine JSON-Auswertung, kein Framing im Root-Prozess). Spike 1.3.0 entscheidet, bevor 1.3.1 beginnt. bestätigt 2026-11-04 (Architekturabweichung vom Review-Vorschlag ist keine, aber betrifft Aufwand). |
| E11 | Ort der Admin-Funktionen (B2) | **bestätigt 2026-11-04:** `admin()`-Plugin, „erster Nutzer = Admin", Rolle/`banned` und `requireAdmin` liefert 0a; Einladung (Token-Link, E14), Nutzerliste, Sperren, Löschen und `user-lifecycle` liefert Phase 1 als API, Meilenstein 1.1 (Aufgaben 1.1.9, 1.1.10). Die Seiten baut das Frontend (E13). |
| E12 | Stdio-Idle und Kindlimit (Spec-Frage 6) | **bestätigt 2026-11-04:** Idle 10 min, max. 5 Kindprozesse je Nutzer (O1). |
| E13 | Zuständigkeit Vue-Dateien (Abgleich Frage 1) | **bestätigt 2026-11-04:** Das Frontend übernimmt alle Dateien unter `app/**`. Phase 1 liefert Routen, Datenformen, Tests und Typen in `shared/api-types.ts`. Aufgaben 1.1.8 bis 1.1.10 und 1.3.5 sind auf die API-Seite reduziert; Abschnitt 4.5 listet die Routen je Bildschirm und ist mit `frontend.md` Abschnitt 5 abgeglichen. |
| E14 | Einladungsmodell (Abgleich Frage 2, W8) | **bestätigt 2026-11-04:** Token-Link `<BASE_URL>/invite/<token>`, 7 Tage gültig, einmal verwendbar, optional an eine E-Mail gebunden, widerrufbar. Tabelle `user_invite` mit Token-Hash. Die reine E-Mail-Allowlist (frühere O5) entfällt; es gibt keinen Schalter „Registrierung per Allowlist". Risiko R14 ist damit weitgehend entschärft (neu formuliert). |
| E15 | Konto-Funktionen (Abgleich Frage 3) | **bestätigt 2026-11-04:** Selbstlöschung und Mail-Funktionen (Mailversand, E-Mail-Verifikation, E-Mail-Änderung per Link, Benachrichtigungen) entfallen. Die Admin-API verbietet das Löschen des eigenen Kontos weiterhin (1.1.10). Keine Tags und keine Gerätenamen im Datenmodell (Abgleich Frage 7). |
| E16 | Dashboard- und Audit-Lesen in Phase 1 (Abgleich Frage 4) | **bestätigt 2026-11-04:** `GET /api/dashboard` (Clients-Tabelle aus `last_used_at`, Status, `call_stat`; Aufmerksamkeitskarte; **ohne KPIs**) in Aufgabe 1.2.9, `GET /api/audit` (Lesen mit Filter und Paginierung) in Aufgabe 1.1.12. Statistik, KPIs, Verlauf, Perzentil-Routen bleiben Phase 2. |
| E17 | Audit-Sichtbarkeit (Abgleich Frage 6) | **bestätigt 2026-11-04:** Nutzer sehen nur eigene Einträge; Admin sieht zusätzlich Instanzereignisse (Nutzer gesperrt/entsperrt/gelöscht, Einstellung geändert, Einladung, Limits). Admin sieht nie Nutzer-Einträge anderer. Umsetzung über `audit_log.scope` (4.2). |
| E18 | Statusmodell, „Aktiv", Limits, SSRF-Liste (Abgleich Abschnitt 4, W1, W4, W6, W7, W9, W10) | Vom Nutzer beauftragt 2026-11-04: (a) Health-Enum um `unknown` ergänzt (war schon vorhanden) und zweite Achse `setup` mit `ready`/`awaiting_auth`/`awaiting_approval` (Abschnitt 4.2, 6). (b) „Aktiv" eines Clients = Aufruf in den letzten 5 Minuten (zustandsloses Gateway, keine Sitzung); die API liefert `active` und `lastActiveAt`, nie „verbunden seit". (c) `degraded` einheitlich definiert (Abschnitt 6); die API liefert `statusReason` als Text, kein fester Wortlaut im UI. (d) Limits: 60/min und 5 parallel **je Upstream**; Nutzer- und Token-Limit sind eigene Zähler und kein „Limit pro Client". (e) SSRF-Ausnahme ist eine Admin-**Liste** (`ssrf.allow`), kein Boolean. |

## 1. Ziel und Abnahmekriterien

Ziel: Ein Nutzer trägt `https://<host>/mcp` in Claude Code ein (OAuth oder PAT aus 0b), legt HTTP- und stdio-Upstreams über die API an (die Oberfläche dazu baut das Frontend auf dieser API), und das Gateway reicht deren Tools namespaced, gefiltert und limitiert durch. Ein Admin lädt Nutzer per Einladungslink ein, sperrt und löscht sie. Danach lassen sich alle eigenen Clients umstellen.

Abnahme (alle prüfbar, Phase fertig wenn grün):
1. **Durchstich:** Claude Code mit **einem** Eintrag: `initialize`, `tools/list`, `tools/call` gegen ≥ 2 HTTP-Upstreams (Bearer, Custom-Header) und 1 stdio-Upstream. Ergebnis, `isError` und Content-Typen text/image/resource kommen unverändert an (Test mit Fake-Upstream, manuell mit Claude Code).
2. **Namespacing:** `<slug>__<tool>`, Slug (≤ 32 Zeichen) je Nutzer eindeutig (DB-Constraint), Kollision zweier Upstreams mit gleichem Toolnamen löst sich korrekt auf.
3. **Isolation:** Nutzer B sieht/ruft/ändert nie Upstreams, Tools, Secrets, Statistiken von A (Isolationstest, 0 Treffer; auch über direkte ID-Zugriffe der API). Admin sieht nur Metadaten, nie Secrets/Tool-Inhalte.
4. **Secrets:** nur verschlüsselt in der DB (AES-256-GCM, nutzerbezogener Schlüssel), nie im Klartext in API-Antworten, Logs, Statistik; App startet ohne `MASTER_KEY` nicht (aus 0a; hier geprüft).
5. **SSRF:** Loopback, Link-Local, private/dokumentations Netze, Metadaten-IPs, IP-Literale in allen Schreibweisen, DNS-Rebinding und Redirect auf interne Ziele sind geblockt, und zwar **vor dem Connect** (Testmatrix, Abschnitt 8, mit echtem lokalem Server); die Admin-Ausnahmeliste `ssrf.allow` (CIDR oder Hostname) weicht genau die eingetragenen Ziele auf.
6. **Tool-Filter:** Änderung wirkt ohne Neustart bei `tools/list` und `tools/call` (deaktiviertes Tool lässt sich auch bei erratenem Namen nicht aufrufen).
7. **Limits:** Rate-Limit pro Upstream (Standard 60/min, 5 parallel) liefert sofort Tool-Fehler mit `retry_after`; globales Limit je Nutzer und je Client-Token; Upper-Bound Upstreams je Nutzer (Standard 50).
8. **Resilienz-Minimum:** Timeouts (10 s/15 s/60 s), Retry nur Connect/Init/List, Breaker öffnet nach 5 Fehlern in Folge, Status per API sichtbar (`status`, `setup`, `statusReason`, `nextRetryAt`); ein hängender Upstream blockiert andere nicht; Abbruch wirkt je Protokoll-Ära richtig (HTTP 2026: Stream schließen, Legacy/stdio: `notifications/cancelled`).
9. **stdio:** Worker pro Nutzer unter eigener UID, die der **Supervisor selbst** aus der `user_id` ableitet (Web-App kann keine UID vorgeben), saubere Env, lazy Start, Idle-Beenden, Neustart mit Backoff; getrennte Verzeichnisbäume (`DATA_DIR` root-eigen), keine Root-Operation folgt Symlinks aus nutzerkontrollierten Pfaden; ohne Capabilities ist stdio für Nicht-Admins gesperrt und die UI nennt den Grund.
10. **Docker:** `docker compose up` mit Beispiel-`compose.yaml` startet `full` und `slim`; Healthcheck grün; Smoke-Test (Abschnitt 8) grün; Daten überleben Neustart.
11. **Persistenz:** neue Migrationen (ab 0003) laufen auf PGlite **und** Postgres (CI gegen beide).
12. **Messwerte:** Gateway-Overhead p95 ≤ 50 ms, aus den Messdatensätzen per `percentile_cont` **und** unabhängig im Lastskript (Client-Zeit minus Fake-Upstream-Zeit); `tools/list` aus Cache ≤ 200 ms bei 10 Upstreams.
13. **Admin-Funktionen (P0-4):** Registrierung nach dem ersten Nutzer nur mit gültigem Einladungs-Token (Link `/invite/<token>`, 7 Tage, einmalig, optional an eine E-Mail gebunden, widerrufbar; Token nur als Hash gespeichert); Admin sperrt/entsperrt/löscht Nutzer; Sperre wirkt sofort auf `/mcp` (OAuth und PAT) und beendet Pool/Worker; Löschen entfernt Upstreams, Secrets, Statistik, Worker samt Verzeichnis; der letzte Admin ist geschützt; kein Löschen des eigenen Kontos.
14. **Umstieg PGlite → Postgres (P0-11):** Dump per `@electric-sql/pglite-tools`, Import in Postgres, Start mit `DATABASE_URL`: Login, Upstreams, Secrets (entschlüsselbar) und Migrationsstand sind erhalten; CI-Job.
15. **API-Vertrag (E13):** Jede Route aus Abschnitt 4.5 ist implementiert, hat Anfrage- und Antworttypen in `shared/api-types.ts` (Handler geben `satisfies <Typ>` zurück), nutzt die einheitliche Fehlerform (4.5) und liefert nie ein Secret (Leak-Scan über alle Antworten). Phase 1 enthält keine Vue-Datei.
16. **Dashboard und Audit lesen (E16, E17):** `GET /api/dashboard` liefert Clients (OAuth und PAT, `active` = Aufruf in den letzten 5 min, `lastActiveAt`, `callsPerMin`) und die Aufmerksamkeitsliste, ohne KPIs; `GET /api/audit` filtert nach Kategorie/Ergebnis/Zeitraum und paginiert per Cursor; Nutzer sehen nur eigene Einträge, Admin zusätzlich Instanzereignisse, nie fremde Nutzereinträge (Isolationstest).

## 2. Annahmen / offene Punkte

Annahmen:
- A1: 0a und 0b sind fertig und erfüllen Abschnitt 3 (Abgleichtabelle des Reviews ist maßgeblich). Abweichungen werden beim Abgleich dort oder hier korrigiert.
- A2: Zielplattform Linux-Container (Docker). macOS-Dev ohne UID-Wechsel: Supervisor erkennt das (Probe), die Web-App läuft dann unter der eigenen UID, `canSwitchUser=false`, stdio nur für Admin.
- A3: Single-Instance. Pool, Katalog-Cache, Rate-Limits, Breaker, Stats-Puffer, `list_changed`-Handler liegen im Prozessspeicher (Spec: Technische Rahmenbedingungen).
- A4: Node ≥ 24.15 (Nuxt-4.6-Engines, 0a); Image: Node 24 LTS (Image-Tag **unverifiziert**).
- A5: Nutzer-IDs sind Strings (Better-Auth-Standard, durch Schema-Generierung bestätigt). Alle FK-Spalten `user_id text`.
- A6: Tests laufen wie in 0a gegen das **gebaute Artefakt als Kindprozess** (`tests/`, `TEST_BACKEND`, `TEST_PG_ADMIN_URL`); reine Modultests (Secrets, SSRF, Limiter, Breaker, Slug) als Unit-Tests ohne Build.

Offen (nicht blockierend, mit Standard):
- O1: Idle-Timeout stdio 10 min, max. 5 Kindprozesse je Nutzer (E12) als Standard, über `user_gateway_limits` änderbar.
- O2: Maximale Länge Gesamt-Toolname: MCP-Clients begrenzen Namen teils (z. B. 64 Zeichen; **unverifiziert**). Slug daher max. 32 Zeichen, Regex `^[a-z0-9][a-z0-9-]{0,31}$` (kein `_`, damit `__` eindeutig trennt). Bereits eingearbeitet, nicht zurückändern.
- O3: Verhalten bei Upstream-Tools, die nicht dem Spec-Schema entsprechen: v2 validiert Ergebnisse gegen das Spec-Schema und lehnt abweichende ab. Beim Durchreichen „1:1" relevant, siehe R3.
- O4: Reverse-Proxy-Header: `X-Forwarded-Proto` wird nur ausgewertet, wenn `TRUST_PROXY=true`; sonst gilt `BASE_URL`.
- O5: Einladung = Token-Link ohne Mailversand (E14): Der Admin erzeugt die Einladung, die API gibt den Link `<BASE_URL>/invite/<token>` **einmalig** zurück, der Admin gibt ihn selbst weiter. Dauer fest 7 Tage (Konstante `INVITE_TTL_DAYS` in `gateway/config.ts`, kein Parameter). Eine E-Mail-Bindung ist optional und wird ohne Verifikation geprüft (der Sign-up muss exakt diese Adresse, kleingeschrieben, verwenden). Eingeladene bekommen immer die Rolle `user`.
- O6: Übergabe des Tokens beim Sign-up: HTTP-Header `X-Invite-Token` am Better-Auth-Request `POST /api/auth/sign-up/email` (Vorschlag; mit dem Frontend abgestimmt, Abschnitt 4.5). Wie der `user.create.before`-Hook den Header liest, ist **unverifiziert** (Spike in 1.1.9; Fallback `hooks.before` auf `/sign-up/email`, das Token prüft und per `AsyncLocalStorage` an den DB-Hook reicht).

Änderungsbedarf Spec v0.4 (aus Phase 1, Sammelliste):
- Einladung = Token-Link mit Ablauf 7 Tage, einmalig, optional E-Mail-gebunden, widerrufbar (P0-4); kein Schalter „Registrierung per Allowlist"; Selbstlöschung und Mail-Funktionen nicht Teil der Spec; Audit-Sichtbarkeit (Nutzer: eigene, Admin: zusätzlich Instanzereignisse); Statusmodell `unknown` plus Achse `setup` (`ready`/`awaiting_auth`/`awaiting_approval`) neben dem Health-Status, `degraded` als Oberbegriff „eingeschränkt" mit Auslöser (a) Fehler in Folge ab Phase 1 und (b) p95 > 3× Basislinie ab Phase 2 (Abschnitt 6); SSRF-Ausnahme als Admin-Liste.
- SDK-Name (v2), zustandsloses Gateway statt „Session-ID im Header", `list_changed` über `subscriptions/listen`, Abbruch über HTTP = Stream schließen (P0-14), Entschlüsselung in der Web-App (P0-5), ENV-Liste (E7), P0-14/P0-15-Phasenzuordnung, Pfad `DATA_DIR/stdio/<uid>` statt `<user_id>` (UID vom Supervisor vergeben, keine Nutzer-ID in Pfaden), `DATA_DIR` root-eigen mit Unterverzeichnis `pgdata` für die Web-App.

## 3. Erwartungen an 0a/0b (Stand nach Schnittstellen-Abgleich des Reviews)

Maßgeblich ist die Abgleichtabelle in `review.md`. Wo 0a/0b noch nicht angepasst sind, gelten die dort getroffenen Entscheidungen. Pfade sind die der Tabelle.

**Datenbank und Schema (0a)**
- `server/db/index.ts`: `getDb(): Promise<Db>`, `closeDb()`, `type Db`, `dbBackend`. Genau ein Client pro Prozess, kein `casing`-Flag (generiertes Schema benennt Spalten explizit), kein `withTx`. Konsumenten typisieren nur gegen `Db`.
- Migrationen laufen **innerhalb des memoisierten `getDb()`-Promise** (Befund B1: Nitro wartet async Plugins nicht ab). Jeder DB-Zugriff ist damit automatisch nach der Migration. Phase-1-Code ruft immer `await getDb()`, nie ein eigenes Handle.
- `server/db/schema/index.ts` (Barrel), `server/db/schema/auth.ts` (generiert, nicht editieren) mit `admin()`-Feldern: `user.role` (`admin`\|`user`), `banned`, `ban_reason`, `ban_expires`. `user.id` ist `text`.
- Skripte `db:schema`, `db:generate`, `db:check`; Ordner `server/db/migrations/`. **Nummern:** 0000 (0a, inkl. `admin()`), 0001 (0b OAuth), 0002 (0b eigene Tabellen), **ab 0003 Phase 1**. Schemaänderungen strikt sequentiell 0a → 0b → 1 (B23); CI-Schritt `db:check` ist Pflicht.

**Konfiguration, Session, Auth (0a)**
- `server/utils/config.ts`: `getConfig()` mit `baseUrl`, `masterKey`, `dataDir`, `allowedOrigins`, `databaseUrl?`. **Phase 1 ergänzt** `stdioMode` (`off`\|`auto`), `trustProxy` (E7) und passt `.env.example` an.
- `server/utils/master-key.ts`: `getMasterKey()`. Die Nutzerschlüssel-Ableitung liegt **nicht** dort, sondern in `server/gateway/crypto/secrets.ts` (eine Datei; 0a §8 wird angepasst).
- `server/auth/options.ts` (Plugins, Hooks), `server/auth/index.ts` (`getAuth(): Promise<Auth>`). **Phase 1 ergänzt in `options.ts`** zwei Hooks: Registrierungsprüfung per Einladungs-Token (Aufgabe 1.1.9, E14; ersetzt die Sperre aus 0a O1 auf der Mutex-Grundlage von B3) und Lebenszyklus-Hooks `user.update.after` (Wechsel `banned` → true) und `user.delete.before` → `user-lifecycle` (Aufgabe 1.1.10), damit auch die vom `admin()`-Plugin selbst exponierten Endpunkte (`/api/auth/admin/*`) den Lebenszyklus auslösen.
- `server/utils/session.ts`: `requireUser(event) → { user, session }` (401) und `requireAdmin(event)` (403 sonst); `user.role` und `user.banned` stehen im Ergebnis. Login-Seite `/login`, Registrierung `/register`. Zweite Testnutzer entstehen im Testharness über `auth.api.createUser` des Admin-Plugins (B3).
- `server/plugins/00-init.ts` (0a). Phase 1 nutzt `server/plugins/20-gateway.ts`, das nur `getDb().then(startJobs).catch(exit(1))` aufruft; alle Gateway-Teile initialisieren lazy.
- `server/routes/healthz.get.ts`, `readyz.get.ts` (0a): Phase 1 **ändert** diese Dateien (Supervisor-Check, Drain-Zustand), legt sie nicht neu an.
- UI: Alle Vue-Dateien, Layouts, Middleware und Komponenten liegen beim Frontend (E13). Phase 1 erwartet davon nichts und liefert keine Seite; sie erwartet nur, dass das Frontend die Routen aus Abschnitt 4.5 so benutzt, wie sie dort beschrieben sind (Abgleich mit `frontend.md` Abschnitte 3 und 5).
- Lesefunktionen aus 0b für die Dashboard-API (1.2.9): `listConnections(userId)` und `listPats(userId)` (Name, `lastUsedAt`, bei OAuth `allowlisted` und `clientId`, ohne widerrufene). Namen **unverifiziert**, bei 0b anfordern; 0b pflegt `last_used_at` bei jedem authentifizierten `/mcp`-Request.

**`/mcp`, Auth-Kontext und Naht (0b)**
```ts
// server/auth/auth-context.ts (0b); Phase 1 verlangt zusätzlich das Feld role
type AuthContext = {
  userId: string
  tokenType: 'oauth' | 'pat'
  tokenId: string                  // für Rate-Limit je Token und Statistik
  clientId: string | null
  clientName: string | null        // untrusted, gekürzt
  scopes: string[]                 // 'mcp:tools'; später 'mcpwarden:admin'
  expiresAt: number | null
  resource: string
  role: 'admin' | 'user'           // 0b ergänzt (access-guard liest die Nutzerzeile ohnehin)
}
```
- Gate-Reihenfolge in 0b fest: Origin → Methode → Token → Zusatzprüfung (Nutzer gesperrt, Client deaktiviert, Consent/Refresh-Token vorhanden) → MCP-Handler. Der Scope heißt `mcp:tools`. **Die Origin-/Host-Prüfung liegt in 0b** (`server/middleware/origin-check.ts`); Phase 1 hat dafür keine Aufgabe mehr.
- **Naht = `ToolSource`** (`server/mcp/upstream-port.ts`, 0b): `listTools(ctx: AuthContext): Promise<ToolDef[]>` und `callTool(ctx, name, args, { signal }: { signal: AbortSignal }): Promise<CallToolResult>`. Phase 1 implementiert `ToolSource` in `server/gateway/index.ts` (`createGatewayToolSource()`) und ersetzt damit den Dummy; das SDK-Server-Objekt, `createMcpHandler` und die Route bleiben 0b. Fehlervertrag: unbekanntes/deaktiviertes Tool = `throw new ToolNotFoundError(name)` (0b bildet das auf den JSON-RPC-Fehler „Tool nicht gefunden" ab, ohne Existenzhinweis); alle anderen Gateway-Fehler kommen als `CallToolResult` mit `isError: true`.
- `signal` ist das Abbruchsignal des eingehenden Requests (Stream geschlossen bzw. `notifications/cancelled` im Legacy-Pfad); 0b reicht es durch.
- **`list_changed`:** 0b exportiert `notifyToolsChanged(userId)`. Die Umsetzung muss Mandantentrennung garantieren (`notify` des SDK geht an **alle** offenen Listen-Streams eines Handlers): entweder ein `createMcpHandler` je Nutzer oder ein nach `userId` gefilterter Bus. Auswahl und Test in Aufgabe 1.2.8; Handler-Schnitt wird mit 0b abgestimmt. Zusätzlich: offene Listen-Streams enden spätestens bei `ctx.expiresAt` und bei `onUserDisabled/Deleted`.
- 0b exportiert für Sperren: `revokePatsOfUser(userId)` und `revokeOAuthGrantsOfUser(userId)` (Consents, Refresh-/Access-Token-Zeilen); Phase 1 ruft beide im Lebenszyklus-Handler auf, damit eine spätere Entsperrung alte PATs/Grants nicht wiederbelebt.
- Einstellungstabelle: **eine** Tabelle `app_setting` (key text pk, value jsonb, updated_at), ohne Präfix, von 0b angelegt; Phase 1 nutzt sie mit den Schlüsseln `stdio.enabled` (bool, Standard `false`) und `ssrf.allow` (Liste CIDR/Hostnamen, Standard `[]`), gleiche Punktnotation wie `oauth.dcr_mode`. Keine eigene `instance_setting`-Tabelle.

**Von Phase 1 selbst geliefert (keine Vorleistung 0a/0b)**
- `server/utils/logger.ts` (strukturiert, Redaction), `server/utils/audit.ts` + Tabelle `audit_log`, `server/utils/user-lifecycle.ts` (Handler-Registry). Aufgabe 1.1.3.
- Einladung (Token-Link), Nutzerverwaltung, Sperren/Löschen als API. Aufgaben 1.1.9, 1.1.10. Lese-Routen `/api/audit` und `/api/dashboard`. Aufgaben 1.1.12, 1.2.9. Einheitliche API-Fehlerform `server/utils/api-error.ts` (Aufgabe 1.1.3).

**Tests (0a-Harness)**
- Verzeichnis `tests/` (`tests/unit`, `tests/integration`, `tests/vitest.config.ts`), Harness `startServer(env)`/`stopServer()`/`api()`, `TEST_BACKEND=pglite|postgres`, `TEST_PG_ADMIN_URL`. Phase 1 ergänzt `tests/helpers/` um `createUser({role})` (über `auth.api.createUser`), `createPat(userId)` (0b-Helfer) und eine DB-Abfrage `withDb(fn)` (Postgres jederzeit, PGlite nur bei gestoppter Instanz; Erweiterung des 0a-Helfers `countMigrations()`), außerdem `tests/fixtures/fake-upstream`. Kein zweiter Harness, kein `@nuxt/test-utils`.

## 4. Architektur-Skizze

### 4.1 Prozesse

```
Client (Claude Code) --HTTPS--> Reverse-Proxy (TLS) --> [Container, Ziel "full"]
  Supervisor (PID≈1 via init, uid 0, Caps: SETUID SETGID CHOWN, no_new_privs)
   ├─ spawn(uid=web, gid=web) → Web-App (Nitro, unprivilegiert)  ← /mcp, UI, API, DB, MASTER_KEY
   │      │  Control-Socket /run/mcpwarden/sup.sock (Datei gehört Web-UID, 0600)
   │      │   1) Steuerverbindung: ping, capabilities, ensureWorker, stopWorker, shutdown
   │      │   2) Datenverbindung je Worker: attach(userId) → Supervisor reicht den
   │      │      Socket-FD an den Worker durch und fasst ihn danach nicht mehr an
   │      ▼
   └─ Worker pro Nutzer (Node, uid = vom Supervisor vergeben, saubere Env, cwd DATA_DIR/stdio/<uid>)
          ▲ Datenverbindung direkt zur Web-App (Stdio-Deskriptor 3)
          └─ stdio-Kindprozesse (gleiche uid; npx/uvx/…)
Ziel "slim": kein Supervisor, kein Socket; Entrypoint startet die Web-App direkt als USER web, stdio fest aus.
```

- **Web-App:** Gateway (`ToolSource`), Pool der HTTP-Clients, Katalog, Limiter, Stats-Puffer, DB. Hält `MASTER_KEY`, `BETTER_AUTH_SECRET`. Hat nie Capabilities.
- **Supervisor** (`supervisor/`, eigenes kleines Bundle, keine DB, kein `MASTER_KEY`): startet die Web-App; Befehle über die Steuerverbindung (`ping`, `capabilities`, `ensureWorker`, `attach`, `stopWorker`, `shutdown`); startet Worker per `child_process.spawn(process.execPath, [workerJs], { uid, gid, cwd, env, stdio: ['ignore','inherit','inherit', dataSocket] })` und überwacht sie (Backoff-Neustart bei Bedarf der Web-App, Aufräumen nach Exit). Er parst **keine** MCP-Frames (E10); das erste Frame einer Datenverbindung (`attach`) ist hart auf wenige hundert Byte begrenzt.
- **Worker** (`supervisor/worker.ts`): kennt kein MCP, kein SDK. Spawnt Kindprozesse (Befehl, Args, Env, cwd kommen von der Web-App über die Datenverbindung), leitet zeilenweises JSON-RPC (stdin/stdout der Kinder) als Frames weiter, zählt Kinder (Limit), erzwingt Limits, legt `home/` und `tmp/` selbst an (als Nutzer, nicht als Root), beendet sich nach Idle samt Kindern. Frames der Gegenseite sind in der Größe begrenzt (Web-App wie Worker).
- **Gateway-Seite stdio:** eigener `Transport` (`IpcTransport`), der `send`/`onmessage` auf Frames der Datenverbindung abbildet; darauf sitzt derselbe MCP-`Client` wie bei HTTP. Pool und Filter sind für beide Typen identisch. Exakte `Transport`-Schnittstelle in v2 beim Bau gegen die Typen prüfen (**unverifiziert**).
- **UID-Zuordnung (Härtung, B5):** Die Web-App sendet nur die `userId` (Format-Prüfung `^[A-Za-z0-9_-]{1,64}$`), **nie eine UID, GID oder einen Pfad**. Der Supervisor führt die Zuordnung `user_id → uid` selbst in `DATA_DIR/stdio/.uidmap` (root-eigen 0600, atomar geschrieben per temp + rename + fsync, fortlaufende Vergabe ab 20000 bis 59999, `gid = uid`). UIDs werden nie wiederverwendet (auch nach Löschen nicht). Damit entfällt die Tabelle `stdio_identity`. Ergebnis ist niemals 0, niemals die Web-UID. Der Worker-`cwd` ist immer `DATA_DIR/stdio/<uid>`. Test mit gefälschten Befehlen (`uid: 0`, Pfad mit `..`, ungültige `userId`).
- **Verzeichnisbäume (Härtung, B6):** `DATA_DIR` ist root-eigen 0755. `DATA_DIR/pgdata` gehört der Web-UID (Spec-Pfad bleibt). `DATA_DIR/stdio` ist root-eigen 0711; die Web-App kann dort nichts anlegen, umbenennen oder durch Symlinks ersetzen. Der Supervisor legt `stdio/<uid>` mit exklusivem `mkdir` an (bei `EEXIST`: `lstat` muss Verzeichnis, kein Symlink, Besitzer root oder `uid` ergeben, sonst Abbruch), öffnet es mit `O_DIRECTORY|O_NOFOLLOW` und setzt Besitzer über den Deskriptor (`fchown`/`FileHandle.chown`; im Zweifel `lchown`) und Modus 0700. **Danach führt Root keine Operation mehr innerhalb von `stdio/<uid>` aus** (Nutzer kontrolliert den Inhalt; sonst Symlink-Angriff auf `chown`). `home/` und `tmp/` legt der Worker als Nutzer an. Löschen eines Nutzers: Supervisor entfernt das Verzeichnis per `rm` mit Nofollow-Semantik erst nach Stopp aller Prozesse dieser UID. Kein rekursives `chown` über Web-kontrollierte Bäume; eine bestehende `pgdata` mit falschem Besitzer führt zu klarer Fehlermeldung samt einmaligem `chown -R`-Hinweis im README (R5).
- **Befehlsauth Steuer-Socket:** Dateirechte (nur Web-UID), Verzeichnis `/run/mcpwarden` root-eigen 0755, Socket per `CHOWN` auf Web-UID. Worker-UIDs können nicht verbinden. Kein Token nötig.
- **Fähigkeitsprobe:** Supervisor startet beim Boot einen Wegwerfprozess mit fremder UID (`node -e 0`, uid 65534). Erfolg → `canSwitchUser=true`. Kein Erfolg → Modus „ohne Nutzerwechsel": Web-App und Worker laufen unter der eigenen UID, nur Admin darf stdio. `STDIO_MODE=off` im Ziel `full`: Supervisor bleibt Entrypoint und lässt die Web-App unter der Web-UID laufen, startet aber weder Probe noch Worker noch Datenverbindungen.
- **Gruppen:** Laut libuv-Quelltext ruft `spawn` bei gesetzten `uid`/`gid` zuerst `setgroups(0, NULL)` auf (mit `CAP_SETGID`), Zusatzgruppen von root bleiben also nicht erhalten. Pflichttest `id -G` bleibt (Aufgabe 1.3.4); ein `setpriv`-Fallback und `util-linux` im Image sind nicht vorgesehen.
- **Limits Kinder:** `ulimit -u` (Prozesse pro UID), `ulimit -v`/`-t` best effort über `sh -c 'ulimit …; exec "$@"'` (**unverifiziert** je Image); Worker: `--max-old-space-size`. Aufruf-Laufzeit: Timeout im Gateway (Standard 60 s). cgroup-Limits nur auf Containerebene (Compose `mem_limit`, `pids_limit`).
- **Restrisiko:** Eine kompromittierte Web-App kann über `attach` Worker beliebiger Nutzer starten und darin Befehle ausführen. Das ist durch die Trennung nicht gedeckt (sie hält ohnehin DB und `MASTER_KEY`); gedeckt ist: sie erreicht weder Root noch UID 0 noch die eigene UID über den Supervisor, und fremde Pfade werden nicht umgebogen. In README festhalten.

### 4.2 Datenmodell (neu in Phase 1)

Alle nutzerbezogenen Tabellen mit `user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE`; alle Repository-Funktionen nehmen `userId` als **ersten** Parameter und filtern darauf (kein Zugriff per ID allein). Ausnahmen: `user_invite` (nur Admin), `audit_log`.

`upstream`
- `id uuid pk default gen_random_uuid()` · `user_id` · `slug text` (Regex siehe O2; **UNIQUE (user_id, slug)**) · `name text` · `description text null`
- `type text` check in (`http`,`stdio`) · `enabled bool default true` · `version int default 1` (jede Änderung +1, invalidiert Pool/Katalog)
- HTTP: `url text null`, `transport text default 'auto'` check in (`auto`,`streamable`,`sse`)
- Auth: `auth_type text default 'none'` check in (`none`,`bearer`,`header`,`env`), `auth_header_name text null`
- stdio: `command text null`, `args jsonb default '[]'`, `env jsonb default '{}'` (nicht geheim), `cwd text null` (relativ zum Nutzerverzeichnis, `..` verboten)
- Limits: `rate_per_min int default 60`, `max_concurrent int default 5`, `timeouts jsonb null` (`{connectMs,listMs,callMs}`)
- Status (nur bei Wechsel geschrieben): `status text default 'unknown'` (`unknown`,`healthy`,`degraded`,`open`,`auth_expired`,`disabled`), `status_reason text null` (kurzer Erklärungstext zum Status, z. B. „3 Fehler in Folge, zuletzt Timeout"; Quelle für `statusReason` der API, im UI nie fest verdrahtet), `status_changed_at`, `last_error text null`, `last_ok_at null`
- Einrichtung (zweite Achse neben dem Health-Status, E18): `setup text default 'ready'` check in (`ready`,`awaiting_auth`,`awaiting_approval`). Phase 1 setzt `awaiting_auth`, solange `auth_type` ≠ `none` ist und noch kein Secret gespeichert wurde (Zustand zwischen Anlegen und `secret.put`), danach `ready`; `awaiting_approval` ist im Enum reserviert und wird erst in Phase 2 (per MCP angelegte stdio-Entwürfe, P0-12) gesetzt. Bei `setup` ≠ `ready` bleibt `status` = `unknown`, der Upstream liefert keine Tools, und `test` antwortet mit dem Code `awaiting_auth`.
- `created_at`, `updated_at`. Check-Constraints: HTTP ⇒ `url` gesetzt; stdio ⇒ `command` gesetzt.

`upstream_secret`
- `id uuid pk` · `user_id` · `upstream_id uuid FK ON DELETE CASCADE` · `kind text` (`bearer`,`header`,`env`) · `name text` (Header- bzw. Env-Name; bei `bearer` `''`) · `ciphertext text` (`v1.<iv>.<ct>.<tag>`, base64url) · `key_version smallint default 1` · `created_at`, `updated_at` · **UNIQUE (upstream_id, kind, name)**.

`upstream_tool` (Tool-Filter + Katalogspiegel für die UI)
- PK (`upstream_id`, `name`) · `user_id` · `enabled bool default true` · `first_seen_at` · `last_seen_at` · `gone bool default false` (nicht mehr im Upstream, Einstellung bleibt erhalten).

`user_gateway_limits` (eine Zeile je Nutzer, Defaults zur Laufzeit gemergt)
- `user_id pk` · `max_upstreams int default 50` · `calls_per_min int default 120` · `max_connections int default 20` · `stdio_allowed bool default false` · `stdio_max_procs int default 5` · `stdio_idle_min int default 10` · `updated_at`.
- Regel stdio: erlaubt = Instanz `stdio.enabled` **und** (`role=admin` **oder** `stdio_allowed`) **und** Supervisor-Fähigkeit (für Nicht-Admins zusätzlich `canSwitchUser`).

`user_invite` (Einladung = Token-Link, nur Admin; Aufgabe 1.1.9, E14)
- `id uuid pk` · `token_hash text NOT NULL UNIQUE` (SHA-256 über das Token; Token = 32 Zufallsbytes, base64url, 43 Zeichen, wird **nie** gespeichert und nur in der Antwort auf das Anlegen als Link geliefert; ein schneller Hash genügt wegen der Entropie) · `email text null` (kleingeschrieben; gesetzt = Bindung, der Sign-up muss diese Adresse nutzen) · `created_by text null REFERENCES "user"(id) ON DELETE SET NULL` · `created_at` · `expires_at timestamptz NOT NULL` (= `created_at` + 7 Tage) · `used_at timestamptz null` · `used_by text null REFERENCES "user"(id) ON DELETE SET NULL` · `revoked_at timestamptz null`. Zustand abgeleitet: `used` > `revoked` > `expired` > `open`. Einmalverwendung per bedingtem `UPDATE … SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND (email IS NULL OR email = $2) RETURNING id` (atomar, Rennen zweier Registrierungen entscheidet die Datenbank). Eingeladene bekommen immer die Rolle `user`. Kein UNIQUE auf `email` (mehrere Einladungen an dieselbe Adresse sind erlaubt, älteres Token kann widerrufen werden).

`audit_log` (E9; Phase 1 legt an und liest, E16/E17)
- `id bigserial pk` · `ts` · `user_id text null` (**ohne FK**, damit Einträge das Löschen des Nutzers überleben; Eigentümer bzw. betroffener Nutzer; keine E-Mail und kein Name in `meta`) · `actor text` (`user:<id>`, `admin:<id>`, `system`) · `client_id text null` · `action text` · `target_type text` · `target_id text null` · `target_label text null` (Slug bzw. Name zum Zeitpunkt des Eintrags; bei Nutzern `null`) · `scope text NOT NULL` check in (`user`,`instance`) · `category text NOT NULL` check in (`management`,`auth`,`status`,`denied`) · `result text NOT NULL default 'success'` check in (`success`,`denied`,`pending`,`status_change`) · `meta jsonb`. `scope`, `category` und `result` leitet `audit()` aus einer Aktionstabelle in `utils/audit.ts` ab (Aufrufer übergeben nur `action`), damit sie nicht auseinanderlaufen.
- **Sichtbarkeit (E17):** Nutzer lesen `scope = 'user' AND user_id = <ich>`; Admin zusätzlich `scope = 'instance'` (alle). Instanzereignisse sind: Nutzer gesperrt/entsperrt/gelöscht, Einstellung geändert (`stdio.enabled`, `ssrf.allow`), Einladung angelegt/benutzt/widerrufen, Limits oder stdio-Freigabe eines Nutzers geändert. Nutzereinträge sind: Upstream anlegen/ändern/löschen, Secret ersetzt, Statuswechsel nach `open`/`auth_expired`/Rückkehr, Tool-Filter geändert. Kein Weg für einen Admin, Einträge anderer Nutzer mit `scope = 'user'` zu lesen.
- Indizes `(user_id, id)` und `(scope, id)`. Phase 1 schreibt nur `category` `management` und `status` sowie `result` `success` und `status_change`; `auth` (Anmeldung hat keine Datenquelle, Abgleich Punkt 30) und `denied`/`pending` (Routing und Freigaben, Phase 2 und 3) sind im Schema vorgesehen, die API filtert darauf, liefert aber leere Listen.

`call_stat` (P0-15, Schreibpfad in Phase 1)
- `id bigserial pk` · `ts timestamptz default now()` · `user_id` · `client_id text null` · `token_id text null` · `upstream_id uuid null ON DELETE SET NULL` · `upstream_slug text` · `tool text null` · `kind text` (`list`,`call`) · `status text` (`ok`,`tool_error`,`timeout`,`upstream_error`,`rate_limited`,`breaker_open`,`denied`) · `total_ms int` · `upstream_ms int null` · `overhead_ms int null` · `retries smallint default 0` · `req_bytes int` · `res_bytes int` · `cache_hit bool default false`.
- Index `(user_id, upstream_id, ts)`, Index `(ts)` für Löschung. Nur Metadaten, nie Argumente/Ergebnisse.

Bewusst nicht im Datenmodell (E15): Tags, Gerätenamen, Mail-Adressen für Benachrichtigungen, Verfügbarkeitsverlauf je Upstream (`health-history`, Phase 2).

Nicht mehr in Phase 1: `instance_setting` (ersetzt durch 0b-Tabelle `app_setting`, Schlüssel siehe Abschnitt 3) und `stdio_identity` (UID-Vergabe liegt im Supervisor, 4.1).

### 4.3 Verschlüsselung der Secrets

- Schlüsselableitung pro Nutzer: `key = HKDF-SHA256(ikm = MASTER_KEY, salt = "mcpwarden/secrets/v1", info = "user:" + userId, len = 32)` über `node:crypto.hkdfSync`. Schlüssel werden nicht gespeichert, nur kurz im Speicher gecacht (LRU, kleine Größe).
- AES-256-GCM, 12-Byte-Zufalls-IV, **AAD = `userId|upstreamId|kind|name`** (bindet Chiffrat an Zeile und Nutzer; ein vertauschter Datensatz schlägt bei der Entschlüsselung fehl).
- API: `server/gateway/crypto/secrets.ts` → `encryptSecret(userId, ctx, plaintext)`, `decryptSecret(userId, row)`. **`userId` kommt immer aus dem Auth-Kontext bzw. der Session, nie aus der Zeile**; das Repository liefert fremde Zeilen ohnehin nicht. Entschlüsselung nur im Pfad „Verbindung aufbauen" (HTTP: Header setzen; stdio: Env über die Datenverbindung direkt an den Worker). Kein Endpoint gibt Klartext zurück; UI bekommt `hasSecret: boolean` und „ersetzen".
- `key_version` reserviert für spätere Master-Key-Rotation (Mechanismus selbst nicht in Phase 1, in README als bekannte Lücke).
- Logger-Redaction deckt Secret-Felder ab; zusätzlich Test, der Logs und API-Antworten nach dem Klartext durchsucht.

### 4.4 Request-Fluss `/mcp`
1. 0b: Gate (Origin → Methode → Token → Zusatzprüfung) liefert `AuthContext`; der MCP-Handler (0b) ruft die `ToolSource` von Phase 1.
2. `ToolSource.listTools(ctx)`: Katalog aus Cache für alle `enabled` Upstreams des Nutzers → Filter (`upstream_tool.enabled`) → Namespacing. Nicht erreichbare Upstreams werden ausgelassen (stale Cache bevorzugt), nie der ganze Aufruf scheitert.
3. `ToolSource.callTool(ctx, name, args, { signal })`: Namen parsen (erstes `__`), Upstream des Nutzers per `(userId, slug)` laden, Prüfung „existiert, gehört dem Nutzer, enabled, Tool enabled" (serverseitig bei jedem Aufruf), Limiter (Nutzer, Token, Upstream), Breaker, Pool, Weiterleitung mit Abbruchsignal, Ergebnis unverändert zurück, Messdatensatz.
4. Fehlerabbildung: Gateway-eigene Fehler (`rate_limited`, `breaker_open`, `timeout`, `upstream_error`, `denied`) kommen als `CallToolResult` mit `isError: true` und klarem Text; unbekanntes/deaktiviertes Tool als `ToolNotFoundError` (kein Hinweis, ob es bei anderem Nutzer existiert).
5. Änderungen am Katalog (Toggle, Upstream an/aus/löschen, geänderte Upstream-Tool-Liste) rufen `notifyToolsChanged(userId)` (Aufgabe 1.2.8).

### 4.5 API-Vertrag für das Frontend (Routen je Bildschirm)

Gilt als Beitrag zu `shared/api-types.ts` (E13): Typen für jede Route entstehen im selben Commit wie die Route, Handler geben `satisfies <Typ>` zurück. Abgeglichen mit `ui-abgleich.md` Abschnitt 5 und `frontend.md` Abschnitte 3 und 5; Abweichungen stehen am Ende dieses Abschnitts und sind dort nachzuziehen.

**Allgemeine Regeln:** JSON, Feldnamen camelCase, Zeitstempel ISO-8601, Zeiten als `…Ms`. Alle Routen außer `GET /api/invites/:token` und den Better-Auth-Routen verlangen `requireUser`, `/api/admin/*` zusätzlich `requireAdmin`. **Fehlerform** (Wunsch E10 des Frontend-Plans übernommen, Helfer `utils/api-error.ts`): `{ statusCode, statusMessage, data: { code, message, field? } }`. Codes: `validation` (400/422, mit `field`), `not_found` (404, auch für fremde Datensätze), `forbidden` (403), `slug_taken` und `limit_reached` (409), `slug_immutable` (422), `awaiting_auth`, `stdio_not_allowed` (403, mit `data.reason`), `invite_required` und `invite_invalid` (403), `self_target` und `last_admin` (409), `invite_not_open` (409). Antworten enthalten nie ein Secret, nur `hasSecret`/`secretNames`. Datenstruktur nach Fachbegriff; Statuswerte englisch (`healthy` …), die Anzeige-Texte liegen im Frontend.

| Bildschirm (Frontend-Seite) | Route | Anfrage → Antwort | Meilenstein |
|---|---|---|---|
| Upstreams-Liste `/upstreams`, Navigations-Badge | `GET /api/upstreams` | → `{ items: UpstreamSummary[] }`; `UpstreamSummary`: `id, slug, name, description, type, url, command, enabled, status, statusReason, statusChangedAt, lastError, lastOkAt, setup, toolsEnabled, toolsTotal, nextRetryAt, rateLimitHits5m, hasSecret`. `p95Ms` und `recent` (24 Balken) fehlen in Phase 1 und kommen in Phase 2 (optional im Typ). `toolsTotal` zählt `gone`-Tools nicht. | 1.1.8; Statusfelder echt ab 1.2.5 |
| Upstream anlegen `/upstreams/new` | `POST /api/upstreams` | `{ name, slug, type, description?, url?, transport?, authType?, authHeaderName?, ratePerMin?, maxConcurrent?, timeouts?{connectMs,listMs,callMs}, command?, args?, env?, cwd? }` → 201 `UpstreamDetail`. Slug-Regex `^[a-z0-9][a-z0-9-]{0,31}$`; 409 `slug_taken` bei Kollision, 409 `limit_reached` ab `maxUpstreams`; stdio ohne Erlaubnis → 403 `stdio_not_allowed`. Neuer Upstream mit `authType` ≠ `none` startet mit `setup = awaiting_auth`. | 1.1.8 |
| Upstream anlegen/bearbeiten (Vorbelegung, Sperrgrund) | `GET /api/me/capabilities` | → `{ mcpUrl, role, stdio:{ allowed, reason? }, limits:{ maxUpstreams, upstreamsUsed, maxConnections, callsPerMin }, defaults:{ ratePerMin, maxConcurrent, timeouts } }`. `reason` ∈ `instance_disabled`, `not_granted`, `no_capabilities`, `supervisor_unreachable`, `image_slim` (Codes, Texte im Frontend). `mcpUrl` = `<BASE_URL>/mcp` (Einrichtungsbefehl im Leerzustand des Dashboards). Standardwerte kommen aus der API, nicht aus dem Frontend-Code. Bis 1.3 ist `stdio.allowed = false` (Grund `supervisor_unreachable`). | 1.1.8; vollständig 1.3.5 |
| Upstream-Detail `/upstreams/[id]` (Übersicht, Auth) und Bearbeiten `/upstreams/[id]/edit` | `GET /api/upstreams/:id` | → `UpstreamDetail` = `UpstreamSummary` + `transport, authType, authHeaderName, ratePerMin, maxConcurrent, timeouts` (effektive Werte), `args, cwd, env` (nur nicht geheime Paare), `secretNames` (nur Namen), `version, createdAt, updatedAt`. Fremde ID → 404. | 1.1.8 |
| dito | `PATCH /api/upstreams/:id` | Teilmenge der Anlegen-Felder plus `enabled` (Aktivieren/Deaktivieren) → `UpstreamDetail`. Der Slug ist unveränderlich (Teil der Tool-Namen): 422 `slug_immutable`. | 1.1.8 |
| dito | `DELETE /api/upstreams/:id` | → 204 (löscht Secrets, Tool-Zeilen, schließt Pool) | 1.1.8 |
| Secret-Feld, „Ersetzen" | `PUT /api/upstreams/:id/secret` | `{ kind:'bearer'\|'header'\|'env', name?, value }` → `{ hasSecret:true, setup }`; `DELETE /api/upstreams/:id/secret?kind=&name=` → 204 (für einzelne Env-Secrets). Nie eine Antwort mit Klartext. | 1.1.8 |
| „Verbindung testen" (Liste, Detail, nach Anlegen) | `POST /api/upstreams/:id/test` | → HTTP 200 mit `{ ok:true, tools:[{name,description}], latencyMs }` oder `{ ok:false, errorCode, message, latencyMs? }`; `errorCode` ∈ `ssrf_blocked`, `redirect`, `timeout`, `connect_failed`, `unauthorized`, `upstream_error`, `protocol`, `awaiting_auth`, `stdio_not_allowed`. Meldungen bereinigt (keine interne IP, kein Secret). Aktualisiert den Status wie ein echter Aufruf. | 1.1.7/1.1.8 |
| Detail, Reiter „Tools" | `GET /api/upstreams/:id/tools` | → `{ items:[{ name, title, description, enabled, gone, firstSeenAt, lastSeenAt, annotations?{readOnlyHint,destructiveHint,idempotentHint} }], fetchedAt, stale }`. Beschreibung und Annotationen aus dem Katalog-Cache (bei `gone` leer). Fehler/p95 je Tool erst Phase 2. | 1.1.7/1.2.2 |
| dito (Schalter, wirkt sofort) | `PUT /api/upstreams/:id/tools/:name` | `{ enabled }` → das geänderte Tool-Objekt; unbekannter Name → 404 | 1.2.2 |
| Annahmeseite `/invite/[token]` | `GET /api/invites/:token` (öffentlich, Rate-Limit je IP) | → `{ valid:true, email, expiresAt }` (`email` = gebundene Adresse oder `null`) oder `{ valid:false, reason:'expired'\|'used'\|'revoked'\|'unknown' }` | 1.1.9 |
| Registrierung `/register`, `/invite/[token]` | `POST /api/auth/sign-up/email` (Better Auth) mit Header `X-Invite-Token` | erster Nutzer: ohne Token, Rolle `admin`; sonst Token Pflicht, fehlt er → 403 `invite_required`, ungültig/abgelaufen/benutzt/falsche E-Mail → 403 `invite_invalid` | 1.1.9 |
| Admin: Nutzer (Einladungen) | `GET /api/admin/invites` | → `{ items:[{ id, email, createdAt, expiresAt, status:'open'\|'used'\|'expired'\|'revoked', usedAt, usedByUserId, createdByUserId }] }` (nie das Token) | 1.1.9 |
| dito | `POST /api/admin/invites` | `{ email? }` → 201 `{ id, email, createdAt, expiresAt, link }`; `link` = `<BASE_URL>/invite/<token>` **nur in dieser Antwort** | 1.1.9 |
| dito | `DELETE /api/admin/invites/:id` | widerruft eine offene Einladung → 204; sonst 409 `invite_not_open` | 1.1.9 |
| Admin: Nutzer (Tabelle) | `GET /api/admin/users` | → `{ items:[{ id, email, name, role, banned, banReason, createdAt, upstreamCount, lastActivityAt, stdioAllowed, limits:{ maxUpstreams, callsPerMin, maxConnections, stdioMaxProcs, stdioIdleMin } }], defaults:{ …gleiche limits-Felder… } }`. `lastActivityAt` = jüngster `call_stat`-Eintrag (nach 14 Tagen ohne Aufruf `null`). Nur Metadaten. | 1.1.10 |
| dito | `POST /api/admin/users/:id/ban` (`{ reason? }`), `POST …/unban`, `DELETE /api/admin/users/:id` | → 204; eigenes Konto → 409 `self_target`, letzter aktiver Admin → 409 `last_admin` | 1.1.10 |
| dito (Limits-Dialog, stdio-Checkbox) | `PUT /api/admin/users/:id/limits` | Teilmenge von `{ maxUpstreams, callsPerMin, maxConnections, stdioAllowed, stdioMaxProcs, stdioIdleMin }` (ganze Zahlen ≥ 1) → Nutzerobjekt wie in der Liste; Entzug von `stdioAllowed` stoppt den Worker | 1.1.10 (Wirkung stdio 1.3.5) |
| Admin: Instanz | `GET`/`PUT /api/admin/settings` | `{ 'stdio.enabled': boolean, 'ssrf.allow': string[] }` (PUT teilweise) → gleiche Form plus `warnings:[{ key, entry, code:'covers_metadata_ip' }]`. Einträge: CIDR (v4/v6) oder genauer Hostname (klein, ohne Schema/Port/Pfad/Wildcard), max. 100; ungültig → 422 mit `field: 'ssrf.allow[i]'`. Metadaten-Adressen werden **nicht** verboten, nur als Warnung gemeldet (Admin entscheidet). Ein Schalter „Registrierung per Allowlist" existiert nicht (E14). | 1.1.11 |
| Audit `/audit` | `GET /api/audit?category&result&from&to&cursor&limit` | → `{ items:[{ id, ts, actorKind:'user'\|'admin'\|'system', actorIsSelf, clientId, clientName, action, category, scope, targetType, targetId, targetLabel, result }], nextCursor }`. Absteigend nach `id`, `limit` Standard 50, max. 200, `cursor` = opake `id`. `clientName` nur wenn auflösbar (sonst `null`). Sichtbarkeit nach E17. Kategorien `auth`/`denied` liefern in Phase 1 leere Listen. | 1.1.12 |
| Dashboard `/` | `GET /api/dashboard` | → `{ clients:[{ kind:'oauth'\|'pat', id, name, allowlisted, active, lastActiveAt, callsPerMin, contextTokensEstimate }], attention:[{ upstreamId, slug, name, status, statusReason, nextRetryAt }], attentionCount }`. **Keine KPIs, keine Zeitreihe** (Phase 2). `active` = letzter Aufruf < 5 min, sonst inaktiv; `callsPerMin` = `call`-Datensätze der letzten 5 min / 5; `contextTokensEstimate` = Größe des jüngsten `list`-Datensatzes / 4 (Schätzung, `null` ohne Datensatz); `allowlisted` nur bei `oauth`, sonst `null`. Widerruf läuft über die 0b-Routen (`DELETE /api/me/connections/:clientId`, `DELETE /api/me/pats/:id`). `attention` = Upstreams mit `degraded`, `open`, `auth_expired`. | 1.2.9 |

**Nicht in Phase 1** (Frontend bleibt für diese Bildschirme im Mock): Statistik und Upstream-Kurven (`/api/stats/*`, `/api/upstreams/:id/stats`, `…/health-history`), Auth-Link-Seiten (`/api/links/*`), stdio-Freigabeseite (`POST …/approve`), Tool-Modus (`/api/me/preferences`), Admin-Statistik, Import/Export. Die Routen für Tokens, Clients, DCR-Admin, Consent und Einstellungen/Sitzungen liefern 0a/0b.

**Abweichungen von bzw. Ergänzungen zu `frontend.md` / `ui-abgleich.md` Abschnitt 5 (im Frontend-Plan nachzuziehen):**
- Feldnamen camelCase (`ratePerMin`, `maxConcurrent`) statt `rate_per_min`/`max_concurrent` des Abgleichs.
- `GET /api/admin/users` liefert `{ items, defaults }` statt einer nackten Liste (Standardwerte für den Limits-Dialog, W5).
- `GET /api/me/capabilities` liefert zusätzlich `mcpUrl`, `role` und `defaults`; Sperrgründe sind Codes.
- Einladung: Annahme-Route `GET /api/invites/:token` mit `reason`; Token-Übergabe beim Sign-up als Header `X-Invite-Token` (O6, offen bis Spike 1.1.9).
- Upstream-Objekt: neu `setup`, `statusReason`, `rateLimitHits5m`; `p95Ms`/`recent` erst Phase 2; `DELETE …/secret` für Env-Secrets; Slug unveränderlich.
- Audit-Eintrag: `scope`, `category`, `result`, `targetLabel`; keine E-Mail-Adressen.
- Dashboard: `contextTokensEstimate` ist eine Schätzung (Bytes/4), `allowlisted` nur bei OAuth; kein Gerätename.
- `/admin/settings`: nur `stdio.enabled` und `ssrf.allow` (kein Registrierungsschalter, keine Retention-Werte in Phase 1).

## 5. Dateien und Pfade

```
server/
  db/schema/gateway.ts             # upstream, upstream_secret, upstream_tool, user_gateway_limits, user_invite, call_stat, audit_log
  db/migrations/0003_*.sql ff.     # drizzle-kit generate (Namen vergibt drizzle-kit)
  gateway/
    index.ts                       # createGatewayToolSource() (ersetzt Dummy aus 0b)
    config.ts                      # Timeouts, Standardlimits, Konstanten
    crypto/secrets.ts              # HKDF + AES-GCM (einzige Krypto-Datei)
    net/ssrf.ts                    # BlockList, assertPublicAddress (Literale + aufgelöste Adressen)
    net/safe-fetch.ts              # fetch für SDK-Transporte: Literal-Prüfung vor Connect, undici-Dispatcher mit connect.lookup, redirect:'error', Retry-After-Erfassung
    upstream/repo.ts               # alle DB-Zugriffe, userId-first
    upstream/slug.ts               # Validierung, Namespacing, Parser
    upstream/connect.ts            # Transportwahl, Auth-Header, Timeouts, SSE-Fallback
    upstream/pool.ts               # (userId,upstreamId) → Client, Single-Flight, Idle-Close, Invalidate
    upstream/catalog.ts            # tools/list-Cache, Upstream-list_changed, Filter
    upstream/breaker.ts            # Zustände closed/open/half-open
    upstream/limiter.ts            # Token-Bucket + Semaphore, user/token/upstream
    upstream/status.ts             # Status-Berechnung, Persistenz bei Wechsel, Audit
    proxy/handlers.ts              # listTools/callTool-Logik hinter der ToolSource
    proxy/errors.ts                # Fehlerabbildung
    proxy/notify.ts                # Aufruf notifyToolsChanged(userId), entprellt
    stats/buffer.ts                # Ringpuffer, Flush alle 5 s/500 Einträgen, stats_dropped
    stats/purge.ts                 # tägliche Löschung Rohdaten
    stdio/supervisor-client.ts     # Steuerverbindung + attach zum Supervisor
    stdio/ipc-transport.ts         # Transport über Frames der Datenverbindung
    stdio/policy.ts                # stdio-Erlaubnis (Instanz, Nutzer, Fähigkeit)
    lifecycle.ts                   # Shutdown, Registrierung der Lebenszyklus-Handler
    admin/invites.ts · users.ts    # Token-Einladung (Erzeugen, Hash, Claim, Widerruf), Sperren/Löschen-Orchestrierung
    dashboard.ts                   # Clients-Zeilen (0b-Lesefunktionen + call_stat), Aufmerksamkeitsliste
  utils/logger.ts · audit.ts · user-lifecycle.ts · api-error.ts
  api/upstreams/index.get.ts · index.post.ts
  api/upstreams/[id].get.ts · [id].patch.ts · [id].delete.ts
  api/upstreams/[id]/secret.put.ts · secret.delete.ts · test.post.ts · tools.get.ts · tools/[name].put.ts
  api/me/capabilities.get.ts
  api/invites/[token].get.ts       # öffentlich, Rate-Limit je IP
  api/audit/index.get.ts · api/dashboard.get.ts
  api/admin/settings.get.ts · settings.put.ts · users/[id]/limits.put.ts
  api/admin/users/index.get.ts · [id]/ban.post.ts · [id]/unban.post.ts · [id].delete.ts
  api/admin/invites/index.get.ts · index.post.ts · [id].delete.ts
  plugins/20-gateway.ts            # Start: Jobs (Stats-Flush, Purge), Shutdown-Hook; wartet auf getDb()
  (geändert: auth/options.ts (Hooks), routes/healthz.get.ts, routes/readyz.get.ts, utils/config.ts)
shared/
  api-types.ts                     # Beitrag zum Vertrag (Typen je Route aus 4.5); Eigentum Frontend, Phase 1 ergänzt im selben Commit wie die Route
# app/** liefert Phase 1 nicht (E13); alle Seiten und Komponenten gehören dem Frontend.
supervisor/
  main.ts · protocol.ts · worker.ts · probe.ts · users.ts (uidmap, Verzeichnisse)   # eigenes Bundle (esbuild) → dist/supervisor/
tools/
  pglite-dump.ts                   # Bundle → dist/tools/pglite-dump.mjs (pgDump über @electric-sql/pglite-tools)
scripts/
  measure-overhead.ts
tests/
  unit/{secrets,ssrf,limiter,breaker,slug,uidmap}.test.ts
  integration/{proxy,isolation,filter,resilience,stats-write,stdio,admin-users,invites,list-changed,audit,dashboard,capabilities,admin-settings,api-contract}.test.ts
  helpers/ (createUser, createPat, withDb)
  fixtures/fake-upstream/{http.ts,stdio.ts}     # steuerbarer Fake-Upstream
  e2e/compose-smoke.sh · e2e/migrate-pglite-to-pg.sh
Dockerfile · compose.yaml · compose.test.yaml · .dockerignore
README.md (Abschnitte Docker, Proxy-Streaming, Backup/Umstieg, stdio-Risiko)
```

## 6. Mindestteile P0-14 / P0-15 in Phase 1 (Entscheidung E3, Begründung)

Warum in den Kern: Timeouts, Fehlerabbildung, Breaker-Zustand und Messdatensatz sitzen im selben Aufrufpfad wie Pool und Proxy. Nachträgliches Einziehen bedeutet, den Pfad in Phase 2 umzubauen und alle Tests neu zu schreiben. Ohne Timeouts kann ein hängender Upstream Gateway-Ressourcen halten (Bulkhead ist Teil der Abnahme „ein langsamer Upstream blockiert andere nicht"). Der Messdatensatz ist die einzige Möglichkeit, das Erfolgskriterium „Overhead p95 ≤ 50 ms" in Phase 1 zu belegen (zusätzlich außen gemessen, B17).

| Teil | Phase 1 | Phase 2 |
|------|---------|---------|
| Timeouts connect 10 s / list 15 s / call 60 s, je Upstream überschreibbar | ja (`upstream.timeouts`), umgesetzt über `AbortSignal` plus `timeout`/`maxTotalTimeout` der SDK-`RequestOptions`; stdio-Connect großzügiger (60 s, R9) | je Tool überschreibbar |
| Abbruch (Timeout oder Client bricht ab) | **je Ära:** Streamable-HTTP-Upstream nach Spec 2026-07-28: Abbruch = Antwort-Stream schließen; Legacy-HTTP und stdio: `notifications/cancelled`. Per Test je Variante nachgewiesen | – |
| Retry Connect/Init/List (3×, 500 ms, Deckel 10 s, Jitter) | ja | – |
| Retry `tools/call` | nein; **nur** Sitzungsverlust bei sessionful Legacy-Upstreams (HTTP 404 auf Session) einmal neu initialisieren und wiederholen | Idempotent-Retry (`readOnlyHint`/Admin-Freigabe) |
| Circuit Breaker | aufeinanderfolgende Fehler (5) → open 30 s, Verdopplung bis 5 min, half-open mit einem Probeaufruf | zusätzlich Fehlerquote > 50 % / 30 s |
| Health-Status | `unknown`/`healthy`/`degraded`/`open`/`auth_expired`/`disabled` passiv aus echten Aufrufen und Test-Button; `auth_expired` bei HTTP 401/403 mit konfigurierter Auth. **`degraded`** (einheitlich mit der Spec, Oberbegriff „eingeschränkt"): Upstream erreichbar bzw. nicht dauerhaft gestört, aber zuletzt 1–4 Fehler in Folge (Verbindung, Timeout, 5xx); Rückkehr zu `healthy` beim nächsten Erfolg; `isError`, Rate-Limit und `denied` zählen nicht. Der Grund steht als Text in `status_reason` und wird als `statusReason` geliefert, das Frontend schreibt keine Bedingung fest. Zweite Achse **`setup`**: `ready`/`awaiting_auth`/`awaiting_approval` (4.2). `unknown` = noch nie verbunden oder `setup` ≠ `ready`. | aktiver Ping alle 60 s; zusätzlicher Auslöser für `degraded`: p95 > 3× 7-Tage-Basislinie (gleicher Status, anderer `statusReason`) |
| Definition „Aktiv" (Clients) | Das Gateway ist zustandslos: ein Client ist **aktiv**, wenn sein letzter Aufruf (`last_used_at`/`call_stat`) weniger als 5 min zurückliegt (Konstante `ACTIVE_WINDOW_MS`), sonst inaktiv. Kein „verbunden seit", keine Sitzung (E18). | – |
| Tools eines `open`-Upstreams | bleiben sichtbar, liefern Fehler | Ausblenden konfigurierbar |
| `/healthz`, `/readyz` | ja (Docker-Healthcheck braucht es; Änderung der 0a-Dateien) | – |
| Bulkhead | Concurrency-Limit je Upstream (Semaphore), getrennte Clients je Upstream | – |
| Graceful Shutdown | ja (SIGTERM, 30 s Drain, Worker beenden) | – |
| `tools/list_changed` | ja, für 2026er-Clients per `subscriptions/listen`, mandantengetrennt (1.2.8) | Push für Legacy nur bei Nachweis |
| Messdatensatz `call_stat` | Schreibpfad mit Puffer, `stats_dropped`, 14-Tage-Löschung, nur `list`/`call` | Verwaltungs-/Routing-Arten |
| Perzentile, Rollups/Histogramme, Aufbewahrung 13 Monate | nein (Rohdaten reichen; Test rechnet `percentile_cont` selbst) | ja |
| Statistik-Seite, `get_stats`, Admin-Aggregate | nein | ja |
| Statuswechsel → Audit | ja (billig, nützlich für Fehlersuche) | Benachrichtigung (P1) |

## 7. Aufgaben je Meilenstein

Reihenfolge: 1.1 → 1.2 → 1.3 → 1.4. 1.3 hängt von 1.2 (Proxy-Pfad) ab, 1.4 kann ab 1.2 mit `slim` beginnen; der Spike 1.3.0 kann schon während 1.2 laufen. Innerhalb 1.1 sind 1.1.9/1.1.10 (Admin), 1.1.11 (Einstellungen) und 1.1.12 (Audit lesen) nach 1.1.3 unabhängig von 1.1.4–1.1.8 und parallel möglich; 1.1.11 muss vor dem Allowlist-Fall der SSRF-Matrix (1.1.5) stehen oder der Test setzt `ssrf.allow` direkt in `app_setting`. 1.2.9 (Dashboard-API) braucht 1.2.5 (Status) und 1.2.6 (`call_stat`). Alle Routen tragen ihre Typen in `shared/api-types.ts` bei (Abschnitt 4.5); Vue-Dateien entstehen hier nicht (E13). Jeder Meilenstein ist einzeln abnehmbar. Der Isolationstest startet in 1.1 und wird je Meilenstein erweitert. Migrationen entstehen strikt nach der letzten von 0b (ab 0003); je Aufgabe mit Schemaänderung gilt: `db:schema`/`db:generate`/`db:check`.

### Meilenstein 1.1 — Upstream-Verwaltung HTTP (Persistenz, Crypto, SSRF, API) und Admin-Funktionen (P0-4)
Abnahme: Über die API (Routen aus 4.5, Frontend baut die Seiten) legt ein Nutzer einen HTTP-Upstream (none/Bearer/Header) an, ersetzt das Secret, testet die Verbindung und erhält die Tool-Liste oder eine konkrete Fehlermeldung; fremde Nutzer sehen nichts; SSRF-Matrix grün. Admin erzeugt Einladungslinks, mit denen sich Nutzer registrieren können; Admin sperrt/entsperrt/löscht Nutzer mit Wirkung auf Tokens und Daten; Admin pflegt `stdio.enabled` und `ssrf.allow`; `GET /api/audit` liefert die sichtbaren Einträge.

**1.1.1 SDK-Wahl festziehen und Abhängigkeiten**
- Zweck: E1 umsetzen, Basis für alle weiteren Aufgaben.
- Dateien: `package.json`, `server/gateway/config.ts`.
- Schritte: Abgleich mit dem Stand von 0b (v2 ist dort gesetzt). Installieren: `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `@modelcontextprotocol/node` (Versionsstand bei Planung: 2.4.0 / 2.4.0 / 2.1.2), `zod@^4.2`, `undici` (npm-Paket für Dispatcher und passendes `fetch`, siehe R16), `@electric-sql/pglite-tools` (Dev, für 1.4.3). Kurzer Probelauf: Client gegen Fake-Upstream `connect` + `listTools`.
- Prüfung: Typecheck, Probelauf grün. DoD: Versionen exakt gepinnt, Abweichung zu 0b dokumentiert.

**1.1.2 Schema und Migration**
- Zweck: Tabellen aus 4.2.
- Dateien: `server/db/schema/gateway.ts`, Migration(en) ab 0003.
- Schritte: Tabellen/Constraints/Indizes anlegen (Fremdschlüssel auf `user.id` aus dem generierten Auth-Schema); Migration mit drizzle-kit erzeugen und einchecken; nur portables SQL (kein PGlite-Sonderfall). `gen_random_uuid()` ist Postgres-Kern seit 13, PGlite basiert auf Postgres 17: der Migrationstest deckt das ab, keine Sonderlösung.
- Prüfung: Migration läuft auf PGlite und Postgres (`TEST_BACKEND`), zweimal idempotent; FK-Cascade-Test (Nutzer löschen → Upstreams/Secrets/Statistik weg, `audit_log` bleibt). DoD: CI-Matrix beider Backends für diesen Test grün.

**1.1.3 Logger, Audit, Lebenszyklus-Registry**
- Zweck: Querschnitt, den 0a/0b nicht liefern (E9).
- Dateien: `server/utils/logger.ts`, `audit.ts`, `user-lifecycle.ts`, `api-error.ts`.
- Schritte: `logger` strukturiert mit Redaction (`authorization`, `secret`, `token`, `password`, `cookie`, `x-invite-token`; Pfade `/invite/<token>` und `/api/invites/<token>` werden in Zugriffslogs maskiert). `audit({ userId, actor, clientId?, action, targetType, targetId?, targetLabel?, meta? })` schreibt in `audit_log`; `scope`, `category` und `result` kommen aus der Aktionstabelle in `audit.ts` (4.2), nicht vom Aufrufer (Fehler beim Schreiben werden geloggt, brechen die Aktion nicht). `api-error.ts`: `apiError(status, code, message, field?)` erzeugt die einheitliche Fehlerform aus 4.5 (h3 `createError`). `user-lifecycle.ts`: `registerLifecycleHandler({ onUserDisabled, onUserDeleted })`, `runUserDisabled(userId)`, `runUserDeleted(userId)` (Handler laufen sequentiell, Fehler eines Handlers werden geloggt und stoppen die anderen nicht).
- Prüfung: Unit-Tests Redaction und Handler-Reihenfolge. DoD: grün.

**1.1.4 Secret-Verschlüsselung**
- Zweck: P0-6, nutzerbezogener Schlüssel.
- Dateien: `server/gateway/crypto/secrets.ts`, `tests/unit/secrets.test.ts`.
- Schritte: HKDF-Ableitung, AES-GCM mit AAD, Format `v1.<iv>.<ct>.<tag>`; Fehler bei Manipulation; kleiner Key-Cache; `userId` ausschließlich als Parameter aus dem Kontext (4.3).
- Prüfung: Roundtrip; Entschlüsseln mit Schlüssel von Nutzer B schlägt fehl; vertauschte Zeile (andere `upstreamId`) schlägt fehl; Chiffrat enthält Klartext nicht; fester Testvektor. DoD: Tests grün, keine Klartext-Rückgabe in irgendeiner API.

**1.1.5 SSRF-Schutz**
- Zweck: P0-9 für HTTP-Upstreams, geprüft **vor** dem Connect.
- Dateien: `server/gateway/net/ssrf.ts`, `net/safe-fetch.ts`, `tests/unit/ssrf.test.ts`.
- Schritte:
  - `node:net.BlockList` mit gesperrten Netzen. IPv4: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0.0/24`, **`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`** (Dokumentationsnetze), `192.168/16`, `198.18/15`, `224/4`, `240/4`. IPv6: `::1`, `::`, `fc00::/7`, `fe80::/10`, `ff00::/8`, **`2001:db8::/32`**; IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96` und **6to4 `2002::/16`** auf eingebettete v4-Adresse prüfen und diese gegen die v4-Liste testen.
  - **Zwei Prüfstellen, beide Pflicht:** (1) `assertPublicAddress(host)` in `safe-fetch` **vor jedem Request** für Hosts, die IP-Literale sind (nach WHATWG-URL-Normalisierung, die Dezimal-, Hex- und Oktalschreibweisen bereits auflöst; IPv6-Klammern entfernen). Bei Literalen läuft kein DNS-Lookup, `connect.lookup` allein würde sie nicht erfassen. (2) Für Hostnamen validiert der undici-Dispatcher mit eigenem `connect.lookup` jede aufgelöste Adresse (schließt die Rebinding-Lücke zwischen Prüfung und Verbindung; ein privater Treffer unter mehreren Records lehnt ab). Zusätzlich Prüfung beim Speichern/Testen als frühe Rückmeldung (nur Komfort, nie Schutz).
  - Nur `http:`/`https:`, keine Userinfo in der URL.
  - `safe-fetch` liefert eine `fetch`-Funktion (Typ `FetchLike`), die an **alle** SDK-Client-Transporte (`StreamableHTTPClientTransport`, `SSEClientTransport`) übergeben wird (Option `fetch` ist in den v2-Typen belegt). `redirect: 'error'`: Redirects werden nicht gefolgt; die Fehlermeldung nennt „Upstream leitet um, bitte Ziel-URL direkt eintragen". Manuelles Folgen mit Neuvalidierung ist bewusst nicht Teil von Phase 1.
  - Admin-Ausnahmeliste (`app_setting` `ssrf.allow`, Liste aus CIDR oder genauem Hostnamen, E18; kein Boolean) wird bei jedem Aufruf frisch gelesen (kurzer Cache ≤ 10 s). Ein CIDR-Eintrag erlaubt Adressen in diesem Netz für jeden Hostnamen, ein Hostname-Eintrag erlaubt genau diesen Namen samt seiner aufgelösten Adressen. Die Liste pflegt `PUT /api/admin/settings` (1.1.11). Wrapper erfasst `Retry-After` der Antwort fürs Limiter-Modul.
- Prüfung: Testmatrix Abschnitt 8, **inklusive Integration mit echtem lokalem Server**, der nachweislich keine Verbindung erhält. DoD: alle Matrixfälle grün; Fall „Ausnahmeliste `ssrf.allow`" grün (CIDR und Hostname); Test, dass ein Transport ohne `safe-fetch` nirgends gebaut wird (Code-Suche/Lint-Regel auf direkte Transport-Konstruktion außerhalb `connect.ts`).

**1.1.6 Upstream-Repository und Validierung**
- Zweck: nutzergebundener Zugriff, Slug-Regeln, Limits.
- Dateien: `server/gateway/upstream/repo.ts`, `slug.ts`, `tests/unit/slug.test.ts`.
- Schritte: Funktionen `list/get/create/update/delete(userId, …)`; Slug-Regex und Auto-Vorschlag aus Name; Obergrenze `max_upstreams` beim Anlegen (409); `version` hochzählen bei Änderung; HTTP-URL-Syntaxprüfung (Schema, Host) zusätzlich zur Laufzeit-SSRF-Prüfung; stdio-Felder in 1.1 nur validieren, noch nicht ausführen: die API lehnt Anlegen/Aktivieren/Test eines stdio-Upstreams bis zur Policy aus 1.3.5 mit 403 `stdio_not_allowed` ab (Policy-Stub, `reason` = `supervisor_unreachable`).
- Prüfung: Unit-Tests Slug (reservierte Namen, `__`, Länge 32), Limit 50, Cross-User-Zugriff liefert `null`. DoD: kein Repo-Aufruf ohne `userId`.

**1.1.7 Verbindungsaufbau, Test, Tool-Katalog (HTTP)**
- Zweck: „Verbindung testen", Grundlage für Pool/Proxy.
- Dateien: `upstream/connect.ts`, `upstream/catalog.ts` (nur `fetchTools`), `api/upstreams/[id]/test.post.ts`, `api/upstreams/[id]/tools.get.ts`.
- Schritte: Transportwahl `auto`: zuerst Streamable HTTP, bei Verbindungsfehler/4xx-Verhalten ohne Streamable-Unterstützung Fallback auf SSE mit frischem Client (Doku-Muster „neuer Client für den Fallback"); erkannte Art in `transport` merken. Auth: `bearer` → `Authorization: Bearer …`, `header` → benannter Header, Secrets frisch entschlüsselt. Alle Transporte mit `fetch: safeFetch`. Verbindungsaufbau mit `AbortSignal.timeout(10_000)`, `listTools` mit 15 s (`signal` und `timeout` der `RequestOptions`). Test-Endpoint liefert `{ok, tools:[{name,description}], latencyMs}` oder `{ok:false, errorCode, message}` mit bereinigter Meldung (kein Secret, keine internen IPs aus SSRF-Treffern: Meldung „Ziel nicht erlaubt (SSRF-Schutz)").
- Prüfung: Fake-Upstream (Streamable-only, SSE-only, 401, hängt, 500, Redirect). DoD: jede Variante liefert die erwartete Meldung; falsches Token → Meldung „401 vom Upstream".

**1.1.8 REST-API Upstreams (nur Server, E13)**
- Zweck: CRUD, Secret ersetzen/löschen, Test, Statusfelder, `capabilities`, als Vertrag für die Frontend-Seiten `/upstreams`, `/upstreams/new`, `/upstreams/[id]`, `/upstreams/[id]/edit`.
- Dateien: `api/upstreams/*` (Liste, Anlegen, Detail, Ändern, Löschen, `secret.put`/`secret.delete`, `test`), `api/me/capabilities.get.ts`, Typen in `shared/api-types.ts`. Keine Vue-Dateien.
- Schritte: Routen und Datenformen genau nach 4.5 (`UpstreamSummary`, `UpstreamDetail`, `setup`, `statusReason`, `rateLimitHits5m`, `secretNames`); `requireUser`; Antworten ohne Secret, mit `hasSecret`; `secret.put` verschlüsselt, erhöht `version` und setzt `setup` auf `ready`; `PATCH` mit `enabled`, Slug unveränderlich (422); Löschen schließt Pool und entfernt Tool-Zeilen; `capabilities` mit `mcpUrl`, `limits`, `defaults` und (bis 1.3.5) fester Sperre `supervisor_unreachable`; einheitliche Fehlerform (`api-error.ts`); Audit-Einträge (angelegt/geändert/gelöscht, Secret ersetzt). Statusfelder sind bis 1.2.5 `unknown`/`null`/`0`, die Form steht aber ab hier fest.
- Prüfung: API-Tests (Validierung je Feld inkl. Slug-Regex, `slug_taken`, `limit_reached`, `slug_immutable`, `awaiting_auth` bei fehlendem Secret, Fremd-ID → 404), Antwort-Leak-Scan, Typprüfung gegen `shared/api-types.ts`. DoD: Isolationstest (Abschnitt 8) für alle neuen Endpunkte grün; Secret taucht in keiner Antwort/Log auf; die Routen sind in 4.5 und im Frontend-Plan abgeglichen. Das Ziel „≤ 2 min vom leeren Formular bis Test grün" prüft das Frontend (frontend.md Aufgabe 10) gegen diese API.

**1.1.9 Admin: Einladung per Token-Link und Registrierung (P0-4, E14)**
- Zweck: Registrierung nach dem ersten Nutzer nur mit gültigem Einladungs-Token; ersetzt die pauschale Sperre aus 0a O1. Nur API (E13); die Seiten `/invite/[token]` und der Einladungsbereich in `/admin/users` baut das Frontend.
- Dateien: `server/gateway/admin/invites.ts`, `server/auth/options.ts` (Hook, geändert), `api/admin/invites/*`, `api/invites/[token].get.ts`, Schema `user_invite`, Typen in `shared/api-types.ts`.
- Schritte: `POST /api/admin/invites` (`{ email? }`) erzeugt 32 Zufallsbytes, speichert nur den SHA-256-Hash, setzt `expires_at` = jetzt + 7 Tage und gibt `link` (`<BASE_URL>/invite/<token>`) **einmalig** zurück; `GET` listet mit abgeleitetem `status` ohne Token; `DELETE` widerruft offene Einladungen (`revoked_at`). Öffentliche `GET /api/invites/:token` (Hash-Lookup, Rate-Limit je IP, keine Unterscheidung außer dem `reason` für den Token-Besitzer) liefert `{ valid, email, expiresAt }` bzw. `{ valid:false, reason }`. Sign-up: Token kommt als Header `X-Invite-Token` (O6). `databaseHooks.user.create.before`: erster Nutzer → erlaubt, Rolle `admin` (0a); sonst fehlt das Token → 403 `invite_required`; Token wird per atomarem `UPDATE … RETURNING` (4.2) beansprucht, scheitert das (unbekannt, benutzt, widerrufen, abgelaufen, E-Mail passt nicht zur Bindung) → 403 `invite_invalid`; `after`: `used_by` setzen, Audit. Scheitert die Nutzeranlage nach dem Claim (z. B. E-Mail bereits vergeben), ist die Einladung verbraucht und der Admin erzeugt eine neue; ob Better Auth den Duplikat-Check vor dem Hook macht (dann tritt das kaum auf), ist **unverifiziert** und wird im Test festgehalten. Die Sign-up-Serialisierung per Mutex (0a, B3) bleibt Grundlage. Audit (angelegt/benutzt/widerrufen, Scope `instance`). Alle Admin-Routen mit `requireAdmin`. Spike zu Beginn: Header-Zugriff im Hook bzw. Fallback `hooks.before` + `AsyncLocalStorage` (O6).
- Prüfung: Test: ohne Token 403 `invite_required`, mit Token ok, zweite Registrierung mit demselben Token 403 `invite_invalid`, abgelaufenes Token (Zeit manipuliert) 403, widerrufenes Token 403, E-Mail-gebundenes Token mit anderer Adresse 403 und mit gleicher Adresse in anderer Schreibweise ok, zwei parallele Registrierungen auf dasselbe Token → genau eine ok, Token taucht weder in Listen, Logs noch Audit auf (Leak-Scan), `GET /api/invites/:token` meldet `reason` korrekt; Nicht-Admin erhält 403 auf der Admin-API. DoD: grün; Hinweis auf R14 (neu) im README.

**1.1.10 Admin: Nutzerliste, Sperren, Löschen, Limits (P0-4)**
- Zweck: Nutzer verwalten; Sperre/Löschen wirken auf Tokens, Pool und Worker. Nur API (E13); Tabelle, Dialoge und die `requireAdmin`-Seitenführung baut das Frontend.
- Dateien: `api/admin/users/*` (inkl. `[id]/limits.put.ts`), `server/gateway/admin/users.ts`, `server/auth/options.ts` (Lebenszyklus-Hooks), `lifecycle.ts`, Typen in `shared/api-types.ts`.
- Schritte: Liste nach 4.5 mit `id`, E-Mail, Name, Rolle, `banned`, `banReason`, Anlagedatum, `upstreamCount`, `lastActivityAt` (jüngster `call_stat`-Eintrag, nach 14 Tagen `null`), `stdioAllowed`, `limits` und `defaults` (nur Metadaten, nie Upstream-Inhalte). `PUT …/limits` setzt die Zeile in `user_gateway_limits` (Teilmenge, ganze Zahlen ≥ 1, Audit Scope `instance`). **Sperren:** Better-Auth `banUser` (beendet Sessions) → Lebenszyklus `onUserDisabled`: Phase-1-Handler schließen Pool des Nutzers, beenden Worker, verwerfen Limiter/Katalog/Listen-Handler, rufen `revokePatsOfUser` und `revokeOAuthGrantsOfUser` (0b). Entsperren: `unbanUser`; PATs und Grants bleiben widerrufen (Nutzer legt neue an). **Löschen:** `onUserDeleted`-Handler zuerst (Pool, Worker inklusive `purge` des Nutzerverzeichnisses über den Supervisor), dann Entfernen des Nutzers; FK-`CASCADE` räumt Upstreams, Secrets, Tool-Zeilen, Limits, `call_stat`. Die Hooks sitzen in den Better-Auth-`databaseHooks` (`user.update.after` bei Wechsel `banned` → true, `user.delete.before`), sodass auch die vom `admin()`-Plugin exponierten Endpunkte (`/api/auth/admin/*`) den Lebenszyklus auslösen. Schutzregeln: kein Sperren/Löschen des eigenen Kontos über diese API (409 `self_target`; eine Selbstlöschung existiert nicht, E15), der letzte aktive Admin ist nicht sperr- oder löschbar (409 `last_admin`). Audit (ohne E-Mail im `meta`, Scope `instance`).
- Prüfung: Test mit Nutzer A (Upstream, PAT, OAuth-Token, offene Pool-Verbindung): Admin sperrt A → nächster `/mcp`-Request mit PAT und OAuth-Token 401, Pool-Zähler 0, nach Entsperren PAT weiter ungültig; Löschen → Upstream-Zeilen weg, Audit-Eintrag bleibt; Aufruf von `/api/auth/admin/ban-user` direkt löst denselben Lebenszyklus aus; letzter Admin nicht löschbar; Nicht-Admin 403. DoD: grün; Abnahme 13 belegt (Worker-Teil in 1.3 ergänzt).

**1.1.11 Admin-Einstellungen (API)**
- Zweck: `stdio.enabled` und die SSRF-Ausnahmeliste `ssrf.allow` pflegbar machen (E18); Voraussetzung für den Allowlist-Fall der SSRF-Matrix.
- Dateien: `api/admin/settings.get.ts`, `settings.put.ts`, Typen in `shared/api-types.ts`.
- Schritte: Lesen/Schreiben der `app_setting`-Schlüssel (Abschnitt 3) mit `requireAdmin`; PUT nimmt eine Teilmenge; Validierung von `ssrf.allow` (CIDR v4/v6 oder genauer Hostname, klein, ohne Schema/Port/Pfad/Wildcard, max. 100 Einträge, sonst 422 mit `field: 'ssrf.allow[i]'`); Warnung `covers_metadata_ip` in der Antwort, wenn ein Eintrag Metadaten-Adressen umfasst (kein Verbot); Cache der SSRF-Liste wird invalidiert; Audit „Einstellung geändert" (Scope `instance`, `meta` mit Schlüssel und Anzahl, nie mit Werten, die interne Topologie verraten). `stdio.enabled` wirkt ab 1.3.5; bis dahin nur gespeichert. Keine Schalter für Registrierung oder Retention (E14, Phase 2).
- Prüfung: API-Tests (Admin ok, Nutzer 403, Validierung, Warnung, Wirkung auf `safe-fetch` in der SSRF-Matrix). DoD: grün.

**1.1.12 Audit lesen (API, E16, E17)**
- Zweck: `GET /api/audit` für die Audit-Seite und die Verwaltungs-Spur; Schreibpfad besteht seit 1.1.3.
- Dateien: `api/audit/index.get.ts`, Lese-Funktion in `utils/audit.ts`, Typen in `shared/api-types.ts`.
- Schritte: Filter `category`, `result`, `from`, `to`; Cursor-Paginierung über `id` absteigend (`limit` Standard 50, max. 200, ungültige Werte → 422); Sichtbarkeit aus 4.2 serverseitig erzwungen (`scope = 'user' AND user_id = ich` bzw. zusätzlich `scope = 'instance'` für Admin); Felder nach 4.5 (`actorKind`, `actorIsSelf`, `targetLabel`; `clientName` best effort über die 0b-Clientliste, sonst `null`; bei Nutzer-Zielen `targetLabel` aus der noch vorhandenen Nutzerzeile, sonst `null`); nie E-Mail-Adressen oder `meta`-Inhalte mit Secrets ausgeben (`meta` wird in Phase 1 nicht geliefert).
- Prüfung: Integrationstest `tests/integration/audit.test.ts`: A sieht eigene Upstream-Einträge, B sieht sie nicht; Admin sieht Instanzereignisse (Sperre, Einstellung, Einladung), aber nicht A's Upstream-Einträge; Nutzer sieht keine Instanzereignisse; Paginierung ohne Lücke/Doppelung bei gleichzeitigen Inserts; Filter; Einträge eines gelöschten Nutzers bleiben für Admin als Instanzereignis sichtbar. DoD: grün; Abnahme 16 (Audit-Teil).

### Meilenstein 1.2 — Tool-Filter + Proxy-Pfad (+ Limits, Resilienz-Minimum, Stats-Schreibpfad, list_changed, Dashboard-API)
Abnahme: Claude Code (oder Testclient) sieht und ruft die Tools aller aktiven HTTP-Upstreams über `/mcp`; Filter, Limits, Timeouts, Breaker, Statistikdatensätze funktionieren; `list_changed` erreicht nur den richtigen Nutzer; Overhead-Messung liegt vor; `GET /api/dashboard` liefert Clients und Aufmerksamkeitsliste aus echten Daten.

**1.2.1 Pool**
- Zweck: eine gepoolte Client-Session je (Nutzer, Upstream), lazy.
- Dateien: `upstream/pool.ts`, `lifecycle.ts`.
- Schritte: Map `userId:upstreamId` → `{client, version, lastUsed, inflight}`; Single-Flight beim Verbinden; neue `version` im Upstream → alten Client schließen (HTTP: `terminateSession()` nur falls der Upstream eine Session vergeben hat, dann `close()`); Idle-Close nach 5 min; Obergrenze `max_connections` je Nutzer (ältester idle fliegt raus, sonst Fehler); `onUserDisabled/Deleted` schließt alles; Upstream-Notification `tools/list_changed` invalidiert Katalog.
- Prüfung: Integrationstest mit Fake-Upstream: zweiter Aufruf nutzt dieselbe Verbindung; Änderung am Upstream erzeugt neue; Nutzer sperren schließt Verbindung. DoD: kein Verbindungsleck (Testzähler offene Sockets nach Test = 0).

**1.2.2 Katalog, Namespacing, Filter**
- Zweck: P0-1 Namen, P0-7 Filter.
- Dateien: `upstream/catalog.ts`, `upstream/slug.ts`, `api/upstreams/[id]/tools/[name].put.ts`, `api/upstreams/[id]/tools.get.ts` (Form nach 4.5, inkl. `annotations`, `stale`).
- Schritte: Katalog je Upstream gecacht (TTL 10 min, Invalidierung durch `version`, `list_changed`, Toggle); beim Fetch `upstream_tool` upserten (`first_seen_at`, `last_seen_at`, `gone`); Aggregation parallel mit Deadline 15 s je Upstream, bei Fehler stale Cache oder auslassen; Namespacing `<slug>__<tool>`; Eingabeschema, Annotationen, `title` unverändert durchreichen; Toggle-API schaltet `enabled`, invalidiert und ruft `notifyToolsChanged` (1.2.8); Audit (Tool-Filter geändert, Scope `user`).
- Prüfung: Zwei Upstreams mit gleichem Toolnamen → zwei Einträge; Toggle wirkt ohne Neustart in der nächsten `tools/list`; Messung `tools/list` aus Cache bei 10 Fake-Upstreams ≤ 200 ms. DoD: grün.

**1.2.3 ToolSource: `listTools`/`callTool`**
- Zweck: P0-1 Kern hinter der Naht von 0b.
- Dateien: `gateway/index.ts`, `proxy/handlers.ts`, `proxy/errors.ts`.
- Schritte: `createGatewayToolSource()` implementiert `ToolSource` (Abschnitt 3); der Dummy aus 0b wird ersetzt, die Route und der MCP-Handler bleiben unverändert. `callTool`: Namen parsen → Upstream per `(userId, slug)` → Prüfungen → Pool → `callTool` des Clients mit Deadline (60 s, Upstream-Override; `signal = AbortSignal.any([ctx-Signal aus 0b, AbortSignal.timeout(ms)])`, dazu `timeout`/`maxTotalTimeout` der `RequestOptions`; Verhalten bei Progress-Notifications im Test klären). Ergebnis wird **unverändert** zurückgegeben (`content`, `structuredContent`, `isError`, `_meta`). Unbekannt/deaktiviert → `ToolNotFoundError` ohne Existenzhinweis. Deaktivierter Upstream (`enabled=false`) → seine Tools fehlen in der Liste und Aufrufe werden abgelehnt.
- Prüfung: Fake-Upstream liefert text, image, resource, `isError`, `structuredContent`; Gateway-Ausgabe identisch (Deep-Equal bis auf Namen in `tools/list`). Aufruf mit erratenem Namen eines fremden Nutzers → gleicher Fehler wie nicht existent. DoD: grün; Claude-Code-Handtest (Abnahme 1).

**1.2.4 Limiter (Rate-Limit pro Upstream, global je Nutzer/Token)**
- Zweck: P0-5 Rate-Limit, P0-4 Obergrenzen.
- Dateien: `upstream/limiter.ts`, `tests/unit/limiter.test.ts`.
- Schritte: Token-Bucket (Kapazität = `rate_per_min`, Nachfüllung gleichmäßig) je (Nutzer, Upstream); Semaphore `max_concurrent` ohne Warteschlange; zusätzlich Bucket je Nutzer (`calls_per_min`) und je `tokenId`; Reihenfolge: Nutzer → Token → Upstream; Verstoß liefert sofort Tool-Fehler `rate_limited` mit `retry_after` (Sekunden, aufgerundet), `_meta.retry_after` und `_meta.limit_scope` (`user`/`token`/`upstream`; das 60/min-Limit gilt **je Upstream**, nie „je Client", E18); Upstream-`Retry-After` (aus `safe-fetch`) blockiert den Upstream bis dahin und taucht im Status auf; Zeitquelle injizierbar für Tests.
- Prüfung: deterministische Unit-Tests mit Fake-Uhr (Burst, Nachfüllung, Parallelität, Retry-After); Integration: 61. Aufruf in einer Minute scheitert sofort. DoD: grün; Treffer erscheinen im Upstream-Objekt der API (`rateLimitHits5m`, Treffer der letzten 5 min aus `call_stat`/Zähler).

**1.2.5 Timeouts, Retry-Grenzen, Breaker, Status**
- Zweck: P0-14 Minimum (Abschnitt 6).
- Dateien: `upstream/connect.ts`, `upstream/breaker.ts`, `upstream/status.ts`, `tests/unit/breaker.test.ts`, `tests/integration/resilience.test.ts`.
- Schritte: einheitlicher Deadline-Helfer (siehe 1.2.3). **Abbruch je Ära:** Gegen Streamable-HTTP-Upstreams der Revision 2026-07-28 bedeutet Abbruch das Schließen des Antwort-Streams (der SDK-Client tut das bei `signal`; per Test belegen); gegen Legacy-HTTP und stdio erwartet der Fake `notifications/cancelled`; sendet der v2-Client sie nicht automatisch, sendet das Gateway sie selbst (**unverifiziert**, Test entscheidet). Retry nur für Connect/Init/List mit Jitter. `tools/call`: kein Retry, außer Sitzungsverlust bei sessionful Legacy-Upstreams (HTTP 404 auf Session-Request → Client neu initialisieren, genau ein erneuter Versuch). Breaker nach Spec-Regel (5 in Folge; open 30 s ×2 bis 5 min; half-open ein Probeaufruf); zählt Verbindungsfehler, Timeouts, 5xx; zählt **nicht** `isError`, ungültige Argumente (Protokollfehler InvalidParams), Rate-Limit, `denied`. Status-Berechnung (Abschnitt 6) mit Persistenz nur bei Wechsel plus Audit bei `open`/`auth_expired` (Kategorie `status`, `result` `status_change`, Scope `user`); jeder Wechsel schreibt `status_reason` (Text, z. B. „5 Fehler in Folge, Breaker öffnet für 30 s") und bei `open` den Wiederversuchszeitpunkt (`nextRetryAt` in der API, im Speicher des Breakers gehalten); `setup` ≠ `ready` hält den Status auf `unknown`.
- Prüfung: Fake-Upstream-Modi `hang`, `500`, `lose-session`, `slow`, `ok`: Timeout nach definierter Zeit; Abbruch beim Upstream angekommen (je Ära: Verbindungsabbruch bzw. `cancelled`); **kein Doppelaufruf** eines nicht-idempotenten Tools bei Timeout/500 (Zähler am Fake); Breaker-Übergänge closed→open→half-open→closed; hängender Upstream A belegt nicht die Concurrency von B. DoD: grün.

**1.2.6 Messdatensatz-Schreibpfad**
- Zweck: P0-15 Minimum, Beleg für Overhead p95.
- Dateien: `stats/buffer.ts`, `stats/purge.ts`, `plugins/20-gateway.ts`, `scripts/measure-overhead.ts`.
- Schritte: je `list`/`call` einen Datensatz (Felder 4.2); Zeiten mit `performance.now()`; `upstream_ms` um den SDK-Aufruf, `overhead_ms = total − upstream`. Puffer im Speicher, Flush alle 5 s oder bei 500 Einträgen als ein `INSERT … VALUES …`; Obergrenze (z. B. 10 000), bei Überlauf älteste verwerfen und `stats_dropped` zählen; Flush-Fehler werden geloggt, nie an den Aufrufer gegeben; kein `await` auf die DB im Aufrufpfad. Tägliche Löschung `ts < now() - 14 d` (Intervall im Prozess; bei mehreren Instanzen später in DB-Job verlagern). Größen: `req_bytes`/`res_bytes` aus JSON-Länge, ohne Inhalte zu speichern. Das Lastskript misst **zusätzlich unabhängig** (Client-Gesamtzeit minus vom Fake-Upstream selbst gemessene Bearbeitungszeit), damit ein Fehler im Stats-Pfad den Beleg nicht verfälscht (B17); `percentile_cont` wird nach Stopp der Instanz über `withDb` gerechnet.
- Prüfung: Lasttest mit Fake-Upstream (1000 Aufrufe) → Datensätze vollständig; DB für 10 s blockiert → Aufrufe laufen weiter, `stats_dropped` steigt nach Überlauf; beide Messwege p95 ≤ 50 ms. DoD: grün, Skript eingecheckt.

**1.2.7 Graceful Shutdown, `/healthz`, `/readyz`**
- Zweck: P0-10/P0-14 Minimum.
- Dateien: `lifecycle.ts`, `routes/healthz.get.ts`, `routes/readyz.get.ts` (0a-Dateien ändern).
- Schritte: **Zuerst klären (Spike, 0a hat es offen gelassen):** ruft Nitro bei SIGTERM den `close`-Hook? Falls nein, registriert das Plugin einen eigenen SIGTERM-Handler (idempotent, einmal). SIGTERM → Flag „draining" (neue `tools/call` → Fehler „Gateway fährt herunter"), laufende bis 30 s, dann Abbruch; Listen-Streams schließen; Pool schließen (inkl. `terminateSession`), Stats flushen; dann DB schließen (0a). `/healthz`: Prozess lebt + `SELECT 1`; `/readyz`: Migrationen durch, Supervisor erreichbar **nur wenn `STDIO_MODE` ≠ off und Ziel `full`**. Upstream-Ausfall beeinflusst beide nie.
- Prüfung: Test mit laufendem Aufruf + SIGTERM; `/readyz` bei gestopptem Fake-Upstream weiter 200. DoD: grün.

**1.2.8 `list_changed` pro Nutzer (B9, E2)**
- Zweck: 2026er-Clients erfahren Katalogänderungen per `subscriptions/listen`, ohne dass ein Nutzer Ereignisse eines anderen sieht.
- Dateien: `proxy/notify.ts`, Anbindung an `notifyToolsChanged(userId)` aus 0b.
- Schritte: **Spike zu Beginn** mit 0b: Auswahl (a) ein `createMcpHandler` je Nutzer (lazy, in einer Map, bei `onUserDisabled/Deleted` und nach Idle geschlossen) oder (b) ein Bus, der Listen-Streams per `userId` filtert (nur falls die Subscription den Kontext tragen kann; **unverifiziert**). Vorrang (a), weil Trennung durch Konstruktion. Auslöser: Tool-Toggle, Upstream an/aus/löschen, vom Upstream gemeldete Änderung nur wenn sich die gefilterte Liste ändert; entprellt (z. B. 200 ms). Grenzen: `maxSubscriptions` je Nutzer, `keepAliveMs` unter dem Proxy-Timeout (README: kein Puffern, lange Timeouts). Listen-Streams enden bei `ctx.expiresAt`, bei Sperre und beim Shutdown.
- Prüfung: A und B haben je einen offenen Listen-Stream; A schaltet ein Tool → nur A bekommt `tools_list_changed`, B nichts; Sperre von A schließt dessen Stream; 2025er-Client (stateless) bekommt keinen Push, sieht die Änderung im nächsten `tools/list`. DoD: grün; Entscheidung (a)/(b) in Abschnitt 4.4 nachgetragen.

**1.2.9 Dashboard-API (E16, E18)**
- Zweck: Clients-Tabelle und Aufmerksamkeitskarte des Dashboards ab Phase 1, ohne KPIs und Zeitreihen (Phase 2).
- Dateien: `gateway/dashboard.ts`, `api/dashboard.get.ts`, Typen in `shared/api-types.ts`.
- Schritte: `clients`: aktive (nicht widerrufene) OAuth-Verbindungen und PATs des Nutzers aus den 0b-Lesefunktionen (Abschnitt 3), je mit `lastActiveAt` aus `last_used_at`; `active` = `lastActiveAt` jünger als `ACTIVE_WINDOW_MS` (5 min); `callsPerMin` aus `call_stat` (`kind = 'call'`, letzte 5 min, gruppiert nach `client_id` bei OAuth bzw. `token_id` bei PAT, geteilt durch 5, eine Nachkommastelle); `contextTokensEstimate` = `res_bytes` des jüngsten `list`-Datensatzes des Clients / 4 (gerundet, `null` ohne Datensatz; im Feldnamen als Schätzung gekennzeichnet); `allowlisted` nur bei OAuth (aus 0b), sonst `null`; Sortierung nach `lastActiveAt` absteigend. `attention`: Upstreams des Nutzers mit `status` ∈ (`degraded`, `open`, `auth_expired`) samt `statusReason` und `nextRetryAt`; `attentionCount` = Länge (Navigations-Badge). Kein Gerätename, keine „verbunden seit"-Angabe, keine Sitzungsbegriffe. Der Stats-Puffer wird vor der Abfrage nicht geflusht (Verzug ≤ 5 s ist dokumentiert).
- Prüfung: `tests/integration/dashboard.test.ts`: Client mit Aufruf vor 1 min → `active`, vor 6 min → inaktiv (Fake-Uhr oder gesetzte Zeitstempel); PAT und OAuth getrennt gezählt; nach Widerruf verschwindet die Zeile; Upstream in `open`/`auth_expired`/`degraded` erscheint in `attention`, `healthy`/`disabled`/`unknown` nicht; Nutzer B sieht nichts von A; Antwort enthält weder Token noch Secret. DoD: grün; Abnahme 16 (Dashboard-Teil).

### Meilenstein 1.3 — stdio-Worker + Supervisor
Abnahme: Ein Admin legt über die API einen stdio-Upstream an (z. B. Fake-Server oder `npx`-Server), Aufrufe laufen über den Worker; zweiter Nutzer ohne Freigabe kann keinen starten; Prozesse laufen unter eigener, vom Supervisor vergebener UID mit sauberer Env; Neustart/Idle/Limits funktionieren; Härtungstests grün.

**1.3.0 Spike: Socket-FD an den Worker durchreichen (E10, B8)**
- Zweck: Entscheidung, ob der Root-Supervisor aus dem Datenpfad entfernt werden kann.
- Dateien: Wegwerfcode im Scratchpad, Ergebnis als Kommentar in `supervisor/main.ts` und Nachtrag in E10.
- Schritte (Zeitbox ½ Tag, im Linux-Container): Supervisor nimmt eine Unix-Socket-Verbindung an, liest das kurze `attach`-Frame, spawnt den Worker mit `stdio: ['ignore','inherit','inherit', socket]` und `uid/gid`, zerstört danach seine eigene Kopie. Prüfen: (1) Worker öffnet `new net.Socket({ fd: 3 })` und liest/schreibt; (2) die Verbindung bleibt nach Schließen der Supervisor-Kopie offen (kein `shutdown`), (3) Gegenseitiger Abbruch: Worker-Exit ⇒ Web-App sieht EOF, Web-App-Close ⇒ Worker sieht EOF, (4) Backpressure bei großen Frames, (5) Worker unter fremder UID darf den bereits geerbten Deskriptor nutzen.
- Ergebnis: Funktioniert → Design aus 4.1 gilt. Scheitert → Fallback aus E10 (roher Byte-Pipe im Supervisor ohne Parsing und ohne Framing), Aufgaben 1.3.1–1.3.3 entsprechend anpassen.
- DoD: Entscheidung dokumentiert, bevor 1.3.1 beginnt.

**1.3.1 Supervisor-Grundgerüst**
- Zweck: Prozess mit Capabilities, Start der Web-App, Steuer-Socket, sichere Verzeichnisse und UID-Vergabe.
- Dateien: `supervisor/main.ts`, `protocol.ts`, `probe.ts`, `users.ts`.
- Schritte: Start (als root mit 3 Capabilities): Verzeichnisse nach 4.1 anlegen (`/run/mcpwarden` 0755, `DATA_DIR` root 0755, `DATA_DIR/pgdata` Web-UID, `DATA_DIR/stdio` 0711 root-eigen). **Reihenfolge beachten:** erst `mkdir`/`chmod`, dann `chown`, weil ohne `CAP_FOWNER`/`CAP_DAC_OVERRIDE` ein `chmod` auf fremd-eigene Verzeichnisse scheitert. Kein rekursives `chown`; falsch gehörende `pgdata` → klare Fehlermeldung. Web-App per `spawn(node, ['.output/server/index.mjs'], { uid: WEB_UID, gid: WEB_GID, env: Web-Env })` starten; Exit der Web-App beendet den Container (Compose startet neu). Signalweitergabe (SIGTERM → Web-App, Drain abwarten, Worker beenden). Fähigkeitsprobe (4.1). Steuer-Socket mit Längenpräfix-JSON-Frames, Versionsfeld, harte Größengrenze. `users.ts`: `.uidmap` laden/atomar schreiben, `uidFor(userId)` (Vergabe 20000–59999, nie Wiederverwendung), `ensureUserDir(uid)` mit `mkdir`-exklusiv, `lstat`-Prüfung, `O_NOFOLLOW`, Deskriptor-`chown`; Befehle akzeptieren nur `userId` (Format geprüft), nie UID/GID/Pfad.
- Prüfung: Unit-Tests `uidmap` (Persistenz, Konkurrenz, Obergrenze, nie 0/Web-UID, Wiederverwendung ausgeschlossen); Integration mit Fake-Web-Befehlen inkl. gefälschter Befehle (`uid: 0`, `cwd: "../.."`, `userId` mit `/`, überlanges Frame) → abgelehnt; Symlink-Test (Web-UID ersetzt `stdio` durch Symlink → nicht möglich, da `stdio` root-eigen; ein vorab als Symlink vorhandenes `stdio/<uid>` → Abbruch statt `chown`); im Container-Test: `/proc/<pid>/status` der Web-App zeigt `CapEff` = 0. DoD: grün (`CapEff`-Prüfung im Smoke-Test 1.4).

**1.3.2 Worker-Lebenszyklus**
- Zweck: ein Worker pro Nutzer, lazy, Idle, Backoff.
- Dateien: `supervisor/main.ts`, `supervisor/worker.ts`, `supervisor/users.ts`, `stdio/supervisor-client.ts`.
- Schritte: Web-App sendet `ensureWorker(userId)` bzw. öffnet die Datenverbindung mit `attach(userId)`; der Supervisor löst UID/Verzeichnis selbst auf, startet den Worker (`uid`, `gid`, `cwd`, **leere Env** mit nur `PATH`, `HOME`, `TMPDIR`, `LANG`, `NODE_OPTIONS=--max-old-space-size=N`; Test prüft, dass `MASTER_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL` fehlen) und übergibt den Deskriptor. Fehler-Event des Spawns → klarer Fehler „Prozessstart nicht möglich (Rechte)". Idle-Timeout (Standard 10 min ohne offene Kinder/Aufrufe) → Worker beendet sich samt Kindern. Absturz → Neustart beim nächsten `attach` mit Backoff (1 s → 30 s), offene Aufrufe erhalten Fehler „Worker neu gestartet" (Web-App sieht EOF der Datenverbindung). `stopWorker(userId, { purge })` beim Sperren/Löschen/Freigabe-Entzug.
- Prüfung: Integrationstest (Abschnitt 8, stdio-Worker-Test). DoD: grün.

**1.3.3 Kindprozesse und IPC-Transport**
- Zweck: stdio-Server wie HTTP-Upstreams im Pool nutzen.
- Dateien: `supervisor/worker.ts`, `stdio/ipc-transport.ts`, `stdio/supervisor-client.ts`, `upstream/connect.ts`.
- Schritte: Web-App entschlüsselt Env-Secrets (E4) und sendet über die Datenverbindung `startChild({upstreamId, command, args, env, cwdRel})`; der Worker spawnt das Kind (Env = nur übergebene + `PATH/HOME/TMPDIR`), prüft, dass `cwd` unter dem Nutzerverzeichnis liegt (Pfadnormalisierung, Symlink-Auflösung; Verteidigung in der Tiefe, da der Worker ohnehin nur Rechte des Nutzers hat), Limit Kindzahl; stdout zeilenweise → Frame, stdin ← Frame, stderr → begrenzter Ring (letzte N KB für Fehlermeldungen, Secrets nicht ausgeben). Gateway-`IpcTransport` implementiert Senden/Empfangen/Schließen; `Client` verbindet darüber; Timeouts/Breaker/Limiter identisch zu HTTP. Kind beendet sich → Transport schließt → Pool-Eintrag neu, Backoff.
- Prüfung: Fake-stdio-Server: Tools listen/aufrufen, Kind stirbt mitten im Aufruf → klarer Fehler, nächster Aufruf startet neu; zu viele Kinder → Fehler `limit`. DoD: grün.

**1.3.4 Isolation, Limits und Härtungstests**
- Zweck: P0-5 Isolation und Ressourcen, Nachweis der Härtungen B5/B6.
- Dateien: `supervisor/worker.ts`, `Dockerfile`-Testziel.
- Schritte: Tests im Container (Linux): Worker/Kind sieht `id -u` = vergebene `uid`, `id -G` enthält **keine** Gruppe 0 (Pflichttest; libuv leert Zusatzgruppen); Nutzer A kann Verzeichnis von B nicht lesen; `DATA_DIR/pgdata` nicht lesbar; Web-App kann `DATA_DIR/stdio` weder ändern noch umbenennen (Schreibversuch als Web-UID scheitert); Symlink-Angriff: Nutzer A legt in seinem Verzeichnis Symlinks (`home -> /etc`, `tmp -> ../<uid von B>`) an, danach erneuter Start/Idle-Zyklus: der Supervisor ändert nirgends Besitzer oder Modus außerhalb (Vorher/Nachher-Vergleich von `stat` auf Zielpfaden); `ulimit -u`-Fork-Bombe-Test begrenzt auf Nutzer; Speicher-Überschreitung beendet nur diesen Worker.
- Prüfung: Container-Integrationstest `tests/integration/stdio-isolation.test.ts` (Docker nötig, in CI als eigener Job). DoD: grün.

**1.3.5 Freigabe-Policy und stdio-Gründe (API, E13)**
- Zweck: P0-5 Freigabe; die API nennt den Grund einer Sperre, das Frontend zeigt ihn an.
- Dateien: `stdio/policy.ts`, Anpassung von `api/me/capabilities.get.ts` und `api/admin/users/[id]/limits.put.ts` (Wirkung), Anbindung an `api/admin/settings.put.ts` (Wirkung von `stdio.enabled`). Keine Vue-Dateien.
- Schritte: Policy aus 4.2 (Instanz-Schalter `stdio.enabled`, Rolle/Nutzerfreigabe, Supervisor-Fähigkeit) ersetzt den Stub aus 1.1.6/1.1.8; `capabilities.stdio.reason` liefert genau einen Code: `instance_disabled` (Admin hat stdio global aus), `not_granted` (Konto nicht freigegeben), `no_capabilities` (Container ohne SETUID/SETGID/CHOWN, Probe `canSwitchUser=false`, nur für Nicht-Admins), `supervisor_unreachable`, `image_slim`; Reihenfolge der Prüfung in dieser Reihenfolge, der erste Treffer gewinnt. Die API lehnt Anlegen/Aktivieren/Test eines stdio-Upstreams serverseitig mit 403 `stdio_not_allowed` samt `data.reason` ab (nicht nur im UI). Freigabe entziehen (`stdioAllowed` → false oder `stdio.enabled` → false) stoppt Worker sofort. Audit (Scope `instance`). Admin sieht nur Metadaten.
- Prüfung: Matrix (Admin/Nutzer × freigegeben/nicht × Fähigkeit ja/nein × Instanz an/aus × Image) per API-Tests mit erwartetem `reason`. DoD: grün; Nutzer ohne Freigabe erreicht nie `attach`/`ensureWorker` (Test mit gefälschtem Request gegen die Web-API).

### Meilenstein 1.4 — Docker, Härtung, Umstieg, Abnahme
Abnahme: Images `slim`/`full`, Compose-Beispiel, Smoke-Test, Umstiegstest, Doku; alle Phase-1-Abnahmekriterien erfüllt.

**1.4.1 Dockerfile**
- Zweck: P0-10.
- Dateien: `Dockerfile`, `.dockerignore`.
- Schritte: Multi-Stage (deps → build `nuxt build` mit Node-Preset → supervisor-Bundle und `tools/pglite-dump`-Bundle → Runtime); Ziele `slim` und `full` (E6): `full` ergänzt `uv`/`uvx` (Bezug über das offizielle uv-Image per `COPY --from`, Tag/Pfad **unverifiziert**) und das Supervisor-Bundle; `slim` ohne Supervisor, `USER web`, `/data` im Image web-eigen (Named Volume übernimmt den Besitz beim ersten Mount); Nutzer `web` (UID/GID 10001) ohne Login-Shell; `HEALTHCHECK` per `node -e fetch('http://127.0.0.1:3000/healthz')` (kein `curl` nötig); Entrypoint `full`: `node dist/supervisor/main.js`, `slim`: `node .output/server/index.mjs`; `ENV STDIO_MODE` je Ziel (`slim` fest `off`). Kein `util-linux`/`setpriv`.
- Prüfung: beide Ziele bauen, Größen notieren, `docker run` ohne Capabilities startet und meldet stdio gesperrt. DoD: Healthcheck wird `healthy`.

**1.4.2 compose.yaml und Betriebsdetails**
- Zweck: P0-10 Beispiel-Compose, TLS-Proxy-Hinweise.
- Dateien: `compose.yaml`, `compose.test.yaml`, `README.md`.
- Schritte: Ziel `full`: `cap_drop: [ALL]`, `cap_add: [SETUID, SETGID, CHOWN]`, `security_opt: ["no-new-privileges:true"]` (`no_new_privs` betrifft nur `exec`-Privilegien, `setuid()` bleibt möglich), `init: true`, `stop_grace_period: 40s`, `pids_limit`/`mem_limit` als Kommentar-Beispiel, Volume `data:/data`, ENV laut Spec (+ E7: `STDIO_MODE`, `TRUST_PROXY`). Ziel `slim`: `cap_drop: [ALL]` ohne `cap_add`. Beispiel-Postgres-Service hinter Profil `pg`. README: ENV-Tabelle, `BASE_URL` muss HTTPS sein außer `localhost`, Reverse-Proxy ohne Pufferung für `/mcp` (Listen-Streams, lange Timeouts), `X-Forwarded-*`, Backup PGlite (Volume bei gestoppter App), Umstieg auf Postgres (1.4.3), stdio-Restrisiko (Netz/Kernel geteilt, kompromittierte Web-App erreicht Worker), Einladungslink als Geheimnis (R14: nur an die gemeinte Person weitergeben, E-Mail-Bindung ohne Verifikation, kein Mailversand), Master-Key-Rotation nicht vorhanden, einmaliges `chown` bei Altvolumes.
- Prüfung: `docker compose up` frisch; zweiter Start behält Daten. DoD: README-Anleitung von Hand nachvollzogen.

**1.4.3 Umstiegstest PGlite → Postgres (P0-11, B4)**
- Zweck: Spec-Zusage „Umstieg per Dump/Import" belegen. Der Import in Postgres ist bisher **ungetestet** (der SQL-Dump per `pgDump` aus `@electric-sql/pglite-tools` wurde nur erzeugt); die Aufgabe beginnt daher mit einem Spike.
- Dateien: `tools/pglite-dump.ts` (Bundle im Image), `tests/e2e/migrate-pglite-to-pg.sh`, CI-Job, README-Abschnitt „Umstieg".
- Schritte: (1) Spike: Dump einer befüllten PGlite-Instanz (Nutzer, Upstreams, Secrets, Stats) mit `pgDump({ pg })`, Import in leeren `postgres:17`; Optionen (`--no-owner`/`--no-acl`, Ausschluss von `call_stat`-Daten), Fehler und Abweichungen (Schema `drizzle`, Sequenzen, Erweiterungen, Versionssprünge) notieren und beheben. (2) Skript: App stoppen → `docker run --rm --user 10001 -v data:/data … node dist/tools/pglite-dump.mjs > dump.sql` → `psql -f dump.sql` im Postgres-Container → App mit `DATABASE_URL` und **gleichem** `MASTER_KEY` starten. (3) Prüfung: Login des vorhandenen Nutzers, Upstreams und Tool-Filter vorhanden, Secret entschlüsselbar (Test-Aufruf gegen Fake-Upstream mit Bearer), `drizzle.__drizzle_migrations` unverändert, kein Migrationslauf, neue Registrierung per Einladung möglich, Sequenzen laufen weiter (neuer `call_stat`-Eintrag ohne Konflikt).
- Prüfung: Skript lokal und als CI-Job grün. DoD: README beschreibt den Ablauf; offene Importprobleme sind behoben oder als bekannte Einschränkung dokumentiert (Abnahme 14).

**1.4.4 Sicherheits- und Abnahmedurchlauf**
- Zweck: Phase-Abnahme (Abschnitt 1).
- Dateien: `tests/e2e/compose-smoke.sh`, ggf. kleine Fixes.
- Schritte: Smoke-Test ausführen (Abschnitt 8), Claude Code real verbinden, zusätzlich ein zweiter Client (Cursor lokal, Fallback MCP Inspector; Claude Desktop/Web bei der ersten öffentlichen Instanz) nach Wahl des Betreibers; Overhead-Skript laufen lassen; Checkliste Abschnitt 1 abhaken; offene Punkte als Issues.
- DoD: alle 16 Abnahmepunkte belegt (Log/Testlauf verlinkt), keine bekannten Hochrisiko-Funde offen.

## 8. Teststrategie

Werkzeuge: Vitest nach 0a-Harness (gebautes Artefakt als Kindprozess, `tests/`), Docker für Container-Tests. CI: Unit + Integration gegen **PGlite und Postgres** (Matrix, `TEST_BACKEND`), separater Job für Docker-Tests, separater Job für den Umstiegstest. Kein automatisches Deployment.

**Fake-Upstream** (`tests/fixtures/fake-upstream`): MCP-Server auf Basis des SDK mit Steuerkanal (`POST /__ctl` bzw. Env/Datei beim stdio-Fake). Modi: `ok`, `hang`, `status500`, `slow(ms)`, `lose-session` (404 auf bekannte Session), `rate429(retryAfter)`, `auth(token|header)`, `redirect`, `tools(list)`, `listChanged`. Zählt Aufrufe je Tool (Doppelaufruf-Nachweis), misst die eigene Bearbeitungszeit (für die unabhängige Overhead-Messung) und protokolliert `notifications/cancelled`, abgebrochene Verbindungen und Header. Ausprägungen: HTTP (Streamable 2026-07-28, Streamable Legacy mit Session, reines SSE) und stdio.

**Isolationstest Nutzer A/B** (ab 1.1, Pflicht in jedem Meilenstein): zwei Nutzer (Anlage über `auth.api.createUser`), A hat Upstream `u1` mit Secret und Tools. B: (1) `GET/PATCH/DELETE /api/upstreams/<id von A>` → 404; (2) `secret.put`, `test`, `tools`, Toggle → 404; (3) `/mcp` `tools/list` enthält keine Tools von A; (4) `tools/call` mit `u1__x` → derselbe Fehler wie bei nicht existent; (5) gleicher Slug bei B erlaubt und trifft B's eigenen Upstream; (6) `decryptSecret(B, rowA)` wirft; (7) Statistik-Zeilen (`call_stat`) von A nie in B's Abfragen; (8) Pool-Schlüssel enthalten Nutzer-ID (Test auf Verbindungsmenge); (9) nach `onUserDisabled(A)` sind A's Verbindungen zu; (10) Nicht-Admin B erhält 403 auf alle `/api/admin/*`; (11) `list_changed`: A's Toggle erzeugt bei B keine Benachrichtigung; (12) `GET /api/audit`: B sieht keine Einträge von A, Admin sieht Instanzereignisse, aber nie A's Nutzereinträge; (13) `GET /api/dashboard`: B sieht weder A's Clients, PATs noch Aufmerksamkeitseinträge. Erweiterung 1.3: Worker von A sieht B's Verzeichnis nicht; B kann über die Web-API keinen Worker für A anstoßen.

**SSRF-Matrix** (Unit mit Fake-Resolver + Integration mit lokalem Server; Erwartung jeweils: abgelehnt **ohne Verbindungsaufbau** zum Ziel, belegt durch den lokalen Server, der nie einen Zugriff sieht, Meldung ohne interne Adresse): Literal-IPs `127.0.0.1`, `[::1]`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `192.0.2.1`, `198.51.100.1`, `203.0.113.1`, `[2001:db8::1]`, `[2002:7f00:1::]` (6to4 mit 127.0.0.1), `[fd00:ec2::254]`, `[::ffff:127.0.0.1]`, `[::ffff:a9fe:a9fe]`, `[64:ff9b::7f00:1]`, Dezimal-/Oktal-/Hex-Schreibweisen (`2130706433`, `0x7f.1`, `017700000001`); Hostname, der auf private IP auflöst; **Rebinding** (Resolver liefert beim ersten Lookup öffentlich, beim zweiten privat → Verbindung scheitert, da Prüfung am Connect-Lookup); Hostname mit mehreren A-Records (ein privater genügt zur Ablehnung); Redirect 302 auf `http://169.254.169.254/` und auf `localhost` (scheitert an `redirect: 'error'`, kein Folgeverkehr); URL mit Userinfo; Schema `file:`/`ftp:`; Ausnahmelisten-Eintrag (`ssrf.allow`, CIDR bzw. Hostname) erlaubt genau das Ziel und nichts Weiteres (auch nicht andere Hostnamen auf dieselbe IP bei Hostname-Eintrag). Zusätzlich je Transport (Streamable und SSE): echter Verbindungsversuch zu einem lokalen Server wird blockiert (beweist, dass die `fetch`-Option greift).

**Resilienz** (1.2.5): siehe Aufgabe; zusätzlich Test „ein Upstream hängt, `tools/list` bleibt < Deadline und liefert die anderen" und Abbruchtest je Ära (HTTP-2026: Fake sieht Verbindungsabbruch; Legacy-HTTP/stdio: `notifications/cancelled`).

**Admin und Lebenszyklus** (1.1.9, 1.1.10): Einladungsmatrix (Token fehlt/ungültig/abgelaufen/widerrufen/benutzt, E-Mail-Bindung, parallele Registrierung, kein Token in Logs/Listen/Audit), Sperren (OAuth, PAT, Pool, Worker), Entsperren, Löschen (CASCADE, Audit bleibt), Weg über `/api/auth/admin/*`, letzter Admin geschützt, kein Sperren/Löschen des eigenen Kontos.

**API-Vertrag** (`tests/integration/api-contract.test.ts`, Abnahme 15): Für jede Route aus 4.5 prüft ein Test Status, Fehlerform und Feldmenge der Antwort gegen die Typen in `shared/api-types.ts` (Laufzeitprüfung über ein aus den Typen abgeleitetes oder handgepflegtes zod-Schema im Testordner) und durchsucht alle Antworten nach Klartext-Secrets und Einladungs-Token; Frontend-Contract-Tests (`tests/ui/contract`) können denselben Server als `CONTRACT_BASE_URL` nutzen.

**stdio-Worker-Test** (1.3): (a) lazy: erst beim ersten Aufruf Worker/Kind; (b) Env-Prüfung: Kind gibt seine Env aus (Fake-Befehl) → nur erlaubte Variablen, Secret des Upstreams vorhanden, `MASTER_KEY` & Co. fehlen; (c) UID/GID/`id -G`; (d) Idle-Beenden mit verkürztem Timeout; (e) Absturz → Backoff-Neustart, laufender Aufruf bekommt Fehler; (f) Kindlimit; (g) `cwd`-Ausbruch (`../`, Symlink) abgelehnt; (h) Policy-Matrix; (i) Supervisor ohne Capabilities (Container ohne `cap_add`): Probe meldet `canSwitchUser=false`, Nicht-Admin gesperrt; (j) Härtung: gefälschte Supervisor-Befehle (UID 0, Pfad, ungültige `userId`), Symlink- und Verzeichnisbaumtests aus 1.3.4; (k) kein MCP-Frame passiert den Supervisor-Prozess (Zähler/Strace-freier Nachweis: Supervisor-Bundle importiert weder SDK noch JSON-RPC-Code, Datenverbindung nach `attach` ohne Lesezugriff des Supervisors).

**Docker-Compose-Smoke** (`tests/e2e/compose-smoke.sh`, 1.4): `docker compose -f compose.yaml -f compose.test.yaml up -d --build` mit `full`; warten auf `healthy`; `/healthz` 200, `/readyz` 200; ersten Nutzer registrieren (0a-API), Einladungslink für Nutzer B über `POST /api/admin/invites` erzeugen und B mit `X-Invite-Token` registrieren (zweite Nutzung des Links scheitert), PAT erzeugen (0b-Helfer), HTTP-Fake-Upstream als Compose-Service anlegen, `tools/list` und `tools/call` via MCP-Client-Skript gegen `/mcp`; stdio-Fake aufrufen, `CapEff` der Web-App = 0 und Worker-UID ≠ 0 per `docker exec` prüfen; Neustart des Containers, Daten und Upstream noch da; `slim`-Variante: stdio gesperrt, HTTP funktioniert; `docker compose stop` → Exit innerhalb Grace-Period, kein Zombie. Aufräumen im Trap.

**Umstiegstest** (1.4.3): `tests/e2e/migrate-pglite-to-pg.sh`, eigener CI-Job mit Postgres-Container.

**Weitere Tests:** Secret-Leak-Scan (Logs und API-Antworten enthalten Klartext-Secret nicht); Konfig: App startet nicht ohne `MASTER_KEY`; Lastskript Overhead (1.2.6); Stats-Puffer (Überlauf, DB-Ausfall).

## 9. Risiken

| Nr | Risiko | Gegenmaßnahme |
|----|--------|---------------|
| R1 | Handler-Modell von 0b weicht von der angenommenen Naht ab (`ToolSource`, `AuthContext` ohne `role`, Handler-Schnitt für `notifyToolsChanged`). | Abgleich als erste Handlung in 1.1.1; Naht `ToolSource` kapselt SDK-Details, Phase 1 fasst den MCP-Server nicht an; `role` und `notifyToolsChanged` bei 0b anfordern. |
| R2 | `list_changed` nur für 2026er-Clients (`subscriptions/listen`); 2025er-Clients zeigen deaktivierte Tools bis zum nächsten `tools/list`. Zusatzrisiko: `notify` erreicht alle Streams eines Handlers (Mandantenleck). | Serverseitige Prüfung bei jedem `tools/call` hält die Sicherheit; Handler je Nutzer bzw. gefilterter Bus (1.2.8) mit Isolationstest; Streams enden bei Token-Ablauf/Sperre. |
| R3 | v2 validiert Upstream-Ergebnisse gegen das Spec-Schema; Upstreams mit leicht abweichenden Antworten werden abgelehnt statt 1:1 durchgereicht. | Früh mit realen Servern testen (mind. 3 verbreitete); bei Bedarf Roh-Weiterleitung auf JSON-RPC-Ebene für `tools/call` prüfen. |
| R4 | Zusatzgruppen von root bleiben beim Nutzerwechsel erhalten. Laut libuv-Quelltext (`setgroups(0, NULL)` bei gesetzter `uid`/`gid`, mit `CAP_SETGID`) erledigt. | Pflichttest `id -G` (1.3.4) bleibt; kein `setpriv`-Fallback, kein `util-linux` im Image. |
| R5 | Root-Prozess mit nur 3 Capabilities: fehlende `DAC_OVERRIDE`/`FOWNER` führen zu überraschenden `EACCES` bei Volume-Rechten (Altvolumes mit fremden Besitzern, `DATA_DIR` jetzt root-eigen). | Reihenfolge mkdir → chmod → chown, kein rekursives `chown`, Startprüfung mit klarer Fehlermeldung, Migrationshinweis im README. |
| R6 | SSRF-Lücke: Entschärft, da die v2-Client-Transporte eine `fetch`-Option haben (Typen geprüft). Restrisiko: ein Transport wird ohne `safe-fetch` gebaut, IP-Literale umgehen `connect.lookup`, Dispatcher greift nicht (R16). | Zwei Prüfstellen (Literal vor Connect + `connect.lookup`), `redirect: 'error'`, Lint-/Codesuche auf direkte Transportkonstruktion, Integrationstest mit echtem lokalem Server je Transport. |
| R7 | PGlite single-connection: Stats-Flush und Statusschreibung konkurrieren mit Anfragen. | Kurze Batch-Inserts statt langer Transaktionen; Flush abseits des Aufrufpfads; Last-Test gegen PGlite. |
| R8 | stdio-Prozesse haben freien Netz-Egress (bekannt, Spec). Ein Nutzer mit Freigabe kann interne Dienste im Container-Netz erreichen. | Standard: nur Admin; README-Warnung; Härtung P2. |
| R9 | `npx`/`uvx` laden beim ersten Start Pakete: lange Startzeit (> Connect-Timeout 10 s) und Schreibzugriff auf `HOME`. | Verbindungs-Timeout für stdio großzügiger (Standard 60 s), `HOME` im Nutzerverzeichnis, Hinweis in UI beim ersten Start. |
| R10 | Gesamtname `<slug>__<tool>` überschreitet Clientgrenzen. | Slug ≤ 32 Zeichen (eingearbeitet); Test mit langen Toolnamen; Kürzungsstrategie nur falls real auftritt. |
| R11 | Umfang von 1.1 (Admin-Funktionen, Einstellungen, Audit lesen) und 1.2 wird zum Engpass; dafür entfallen alle Vue-Dateien (E13). | 1.1 teilbar: 1.1.1–1.1.8 (Upstreams), 1.1.9–1.1.12 (Admin, Einstellungen, Audit; parallel möglich); 1.2 in zwei Abnahmen: 1.2.1–1.2.3 (Proxy), 1.2.4–1.2.9 (Limits/Resilienz/Stats/`list_changed`/Dashboard-API). |
| R12 | Master-Key-Rotation fehlt; Verlust des Keys macht alle Secrets unbrauchbar. | `key_version` reserviert; README: Key sichern; Rotation in Phase 2/P1 planen. |
| R13 | Spike 1.3.0 (FD-Durchreichung) scheitert oder verhält sich plattformabhängig. | Fallback roher Byte-Pipe im Supervisor ohne Parsing (E10); Entscheidung vor 1.3.1; Mehraufwand gering. |
| R14 | Das Rennen um eine E-Mail-Allowlist entfällt mit dem Token-Link (E14). Restrisiko: Wer den Link kennt, kann sich registrieren (Weitergabe, Referrer, Zugriffslogs, Browser-Verlauf); eine E-Mail-Bindung wird nicht verifiziert; ein verbrauchter Token bei fehlgeschlagener Nutzeranlage. | Token 256 Bit, nur als Hash gespeichert, einmalig, 7 Tage, widerrufbar, optional E-Mail-gebunden; Atomarer Claim (kein Doppelverbrauch); Token-Maskierung in Zugriffslogs und Redaction des Headers; öffentliche Prüfroute mit Rate-Limit je IP; Frontend setzt `Referrer-Policy: no-referrer` auf `/invite/*`; Admin sieht Registrierungen und kann sperren; README-Hinweis. |
| R15 | Import PGlite-Dump in Postgres ungetestet; Dumpformat, Sequenzen, Schema `drizzle` oder Versionssprung können scheitern. | Umstiegstest mit Spike am Anfang von 1.4.3, CI-Job, dokumentierte Einschränkungen. |
| R16 | `undici`-npm-Dispatcher passt nicht zum in Node eingebauten `fetch`; Dispatcher-Option wird ignoriert. | `undici.fetch` aus dem installierten Paket mit eigenem Dispatcher in `safe-fetch` verwenden; Test mit echtem lokalem Server beweist die Wirkung. |
| R17 | Nitro wartet async Plugins nicht ab; SIGTERM ruft evtl. den `close`-Hook nicht. | Gateway initialisiert lazy über `await getDb()`; eigener SIGTERM-Handler nach Spike in 1.2.7; `/readyz` bleibt Garant. |

## 10. Geprüfte Versionen und Unverifiziertes

Geprüft (Stand 2026-11-04, Details in `review.md` S1–S13):
- npm: `@modelcontextprotocol/sdk` 1.32.2 (v1-Linie, nur Wartung); `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.4.0, `@modelcontextprotocol/node` 2.1.2 (alle Node ≥ 20); `zod` 4.6.7; `undici` 8.12.3; `@electric-sql/pglite` 0.5.15, `@electric-sql/pglite-tools` 0.4.15; nuxt 4.6.4, better-auth 1.7.17.
- Client-Typen v2 (2.4.0): `StreamableHTTPClientTransport` und `SSEClientTransport` haben `fetch?: FetchLike`; `RequestOptions` hat `signal`, `timeout`, `maxTotalTimeout` (damit sind R6 und „unverifiziert: timeout/signal/fetch" entschärft).
- Server-Typen v2 (2.4.0): `createMcpHandler` mit `legacy: 'stateless' | 'reject'`, `bus`, `maxSubscriptions`, `keepAliveMs`, Rückgabe `{ fetch, close, notify, bus }`; `subscriptions/listen` wird unterstützt, `notify` erreicht alle offenen Listen-Streams **des Handlers**; Hilfen `originValidationResponse`, `hostHeaderValidationResponse`, `isLegacyRequest` (Origin/Host-Prüfung liegt in 0b).
- MCP-Spec 2026-07-28: keine Sessions, `list_changed` über `subscriptions/listen`, Abbruch auf Streamable HTTP = Antwort-Stream schließen (`notifications/cancelled` nur noch auf stdio), Origin vorhanden und ungültig → 403.
- SDK-Doku v2: stdio `close()` = stdin schließen, dann `SIGTERM`, dann `SIGKILL`; Streamable HTTP: `terminateSession()` vor `close()`; `StdioClientTransport`-Optionen ohne `uid/gid` (Phase 1 nutzt für stdio ohnehin den eigenen Worker); Fehlerklassen `ProtocolError`/`SdkHttpError` (Status in `.status`); Zod ≥ 4.2.
- Node `child_process.spawn`: Optionen `uid`/`gid`, `env`, `stdio` (Stream/Socket-Objekte werden als Deskriptor dupliziert, Doku; nicht live geprüft, Spike 1.3.0), `'error'`-Event bei nicht startbarem Prozess.
- libuv (`src/unix/process.c`): bei gesetzter `uid`/`gid` vorheriges `setgroups(0, NULL)`.
- Docker-Doku: `--cap-add`/`--cap-drop` mit `ALL`; `CHOWN`, `SETGID`, `SETUID` gehören zum Standardsatz und sind droppbar.
- Linux (Handbuch Capabilities, Kernel-Doku): `CAP_SETUID`/`CAP_SETGID`/`CAP_CHOWN`/`CAP_DAC_OVERRIDE`/`CAP_FOWNER`-Semantik; `exec` durch Nicht-Root-UID löscht Permitted/Effective; `no_new_privs` betrifft nur `exec`-Privilegien, `setuid()` bleibt möglich.
- `pgDump({ pg })` aus `@electric-sql/pglite-tools` erzeugt einen SQL-Dump mit Daten und `drizzle`-Schema auf einer PGlite-Instanz; **Import in Postgres nicht getestet**.

Unverifiziert (beim Bau prüfen):
- v2-Client: ob ein `signal`-Abbruch gegen Legacy-HTTP/stdio automatisch `notifications/cancelled` sendet (Test 1.2.5); Zusammenspiel von `timeout`/`maxTotalTimeout` mit Progress-Notifications; ob alle Requests der Transporte (inkl. SSE-Stream) die übergebene `fetch` nutzen; exakte `Transport`-Schnittstelle für `IpcTransport`; ob die SSE-Client-Nutzung in v2 als veraltet markiert ist.
- v2-Server/0b: ob eine Subscription den Nutzerkontext für einen gefilterten Bus trägt (sonst Handler je Nutzer, 1.2.8); Rolle des Legacy-Pfads für 2025er-Clients in `createMcpHandler` (0b bestätigt mit echtem Claude Code).
- Socket-FD-Durchreichung an `spawn` (`stdio` mit Socket): Verhalten beim Schließen der Elternkopie, Backpressure (Spike 1.3.0).
- Node: Fehlerverhalten (`EPERM`) bei fehlender Capability; Verhalten von `FileHandle.chown` auf Verzeichnis-Deskriptoren.
- Compose-Schlüssel (`init`, `stop_grace_period`, `pids_limit`) gegen aktuelle Compose-Referenz; Basis-Image-Tag (Node 24 LTS, Debian-Variante); `uv`-Image-Pfad; Verfügbarkeit von `prlimit`/`ulimit -v` im gewählten Image.
- Ob Nitro bei SIGTERM den `close`-Hook ruft (Spike 1.2.7, mit 0a abgestimmt).
- PGlite-Dump: Optionen (`--no-owner`, `--no-acl`), Import-Verhalten in `postgres:17` (Spike 1.4.3); `percentile_cont`-Verhalten identisch (Spec behauptet es, in 1.2.6 mitgetestet).
- Maximale Toolnamen-Länge gängiger Clients.
