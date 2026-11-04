# Phase 0b: OAuth-Provider und erster Durchstich

Stand: 2026-11-04 (überarbeitet nach `docs/plans/review.md`) · Basis: `docs/spec.md` v0.3 · Abhängigkeit: Phase 0a (`docs/plans/phase-0a.md`). Wo 0a noch nicht angepasst ist, gelten die Entscheidungen der Abgleichtabelle im Review (Abschnitt 3).

Kennzeichnung: **Annahme (bestätigt 2026-11-04)** = Empfehlung des Reviews, vom Nutzer gesammelt bestätigt.

**Zuständigkeit (bestätigt 2026-11-04, Folge von `docs/ui-abgleich.md`, Frage 1):** Das Frontend (`docs/plans/frontend.md`) übernimmt **alle** Vue-Dateien unter `app/**`. 0b liefert nur `server/**`, Tests und Vertragsbeiträge in `shared/api-types.ts`. Consent-Seite, DCR-Admin-Seite sowie Token- und Clients-Seiten baut das Frontend gegen die Routen in Abschnitt 4.1. Die Aufgaben 3 bis 5 sind deshalb auf die API-Seite reduziert (Routen, Datenformen, Tests).

## 1. Ziel und Abnahmekriterien

Erster vertikaler Durchstich: Login → Consent → Token → `tools/list`/`tools/call` gegen einen Dummy-Upstream, über `/mcp`.

Fertig, wenn alle Punkte erfüllt sind:

- [ ] A1: `claude mcp add --transport http mcpwarden <BASE_URL>/mcp`, dann `/mcp` in Claude Code → Browser-Login → Consent → verbunden. Claude Code sieht `dummy__echo` (und weitere Dummy-Tools) und ruft sie erfolgreich auf.
- [ ] A2: **Cursor** als zweiter Pflichtclient verbindet sich per OAuth und ruft ein Dummy-Tool auf (bestätigt 2026-11-04; Fallback nur bei nachgewiesenem Cursor-Problem: MCP Inspector, dann im Protokoll als Abweichung vermerkt; Claude Desktop/Web erst bei der ersten öffentlichen Instanz in Phase 1.4; siehe 6.3).
- [ ] A3: Automatisierter Flow-Test (DCR → Authorize → Login → Consent → Token → Refresh → `/mcp` → Widerruf → 401) ist grün gegen PGlite und gegen Postgres (CI-Matrix aus 0a).
- [ ] A4: Discovery: `/.well-known/oauth-protected-resource` (und Pfadvariante `/mcp`) sowie `/.well-known/oauth-authorization-server` liefern korrektes JSON. Ungültige/fehlende Auth auf `/mcp` → 401 mit `WWW-Authenticate: Bearer resource_metadata="…"`, kein Tool-Leak.
- [ ] A5: Token mit falscher Audience wird abgelehnt (401). **Sofortiger Widerruf:** Nach Sperre des Nutzers, Deaktivieren/Löschen des Clients, Widerruf des Consents **und** Widerruf allein des Refresh-Tokens (RFC 7009, Consent bleibt) liefert der nächste Request mit einem noch gültigen JWT 401, ohne Ablauf abzuwarten (Aufgabe 6). Dasselbe für PATs nach Widerruf bzw. Sperre des Nutzers.
- [ ] A6: DCR-Policy `aus` / `nur Allowlist` / `offen mit Warnung` per Admin-API umschaltbar, Standard `offen mit Warnung`; `consent-info` liefert `allowlisted` je Client, damit das Frontend bei unbekannten Clients warnen und eine aktive Bestätigung verlangen kann. Die Admin-Routen sind nur für `role=admin` erreichbar (Nicht-Admin: 403, anonym: 401).
- [ ] A7: PATs erzeugen/benennen/widerrufen (API); nur Hash gespeichert; Klartext einmalig in der POST-Antwort; `last_used_at`; `Authorization: Bearer mcpw_pat_…` funktioniert auf `/mcp`.
- [ ] A8: Origin-Prüfung: ungültiger `Origin` → 403; fehlender `Origin` (CLI-Clients) wird durchgelassen.
- [ ] A9: `tools/list_changed` per Push: Ein 2026-07-28-Client (SDK-Client v2) hält `subscriptions/listen` offen; ein serverseitiger Auslöser (Dummy-Tool-Umschalter, steht für den Phase-1-Toggle) liefert ihm `tools_list_changed`. Ein zweiter Nutzer mit offenem Stream bekommt **nichts** (Mandantentrennung). 2025-11-25-Clients erhalten keinen Push und sehen die Änderung beim nächsten `tools/list` (bewusst akzeptiert).
- [ ] A10: Abbruch über HTTP = Schließen des Antwort-Streams: Bricht der Client einen laufenden `tools/call` (`slow_echo`) ab, sieht die `ToolSource` das `AbortSignal` innerhalb kurzer Zeit (Test).
- [ ] A11: Vertrag: `shared/api-types.ts` enthält Typen für jede Route aus Abschnitt 4.1; die Routen erfüllen sie (`satisfies`), Formtests (Aufgabe 9) sind grün, Secrets kommen in keinem Antworttyp vor.

Hinweis zu A1 und A2: Login-, Consent- und Clients-Seiten stammen vom Frontend (Frontend-Plan Aufgabe 7 bis 9). Die manuelle Abnahme (Aufgabe 10) setzt diese Seiten voraus; bis dahin deckt der automatisierte Flow-Test (A3) den Ablauf ab.

## 2. Annahmen und offene Punkte

Geprüfte Versionen (npm-Registry bzw. offizielle Doku, abgerufen 2026-11-04; im Review gegengeprüft, S13):

| Paket | Version | Quelle |
|---|---|---|
| `better-auth` | 1.7.17 | npm |
| `@better-auth/mcp` | 1.7.17 | npm, better-auth.com/docs/plugins/mcp |
| `@better-auth/oauth-provider` | 1.7.17 | npm, Doku |
| `@better-auth/cimd` | 1.7.17 | npm, Doku |
| `@modelcontextprotocol/server` / `client` | 2.4.0 | npm, ts.sdk.modelcontextprotocol.io/v2 |
| `@modelcontextprotocol/sdk` (v1-Linie) | 1.32.2 | npm |
| `nuxt` | 4.6.4 (Nitro 2, h3 v1) | npm |
| `drizzle-orm` | 0.45.4 | npm |
| `@electric-sql/pglite` | 0.5.15 | npm |
| MCP-Spezifikation | 2026-07-28 ist "latest"; 2025-11-25 ist die ältere Revision | modelcontextprotocol.io |

Entscheidungen und Annahmen:

1. **SDK-Paketname:** Spec nennt `@modelcontextprotocol/sdk`; Stand heute ist das die v1-Linie. v2 heißt `@modelcontextprotocol/server`/`client`, die Better-Auth-Doku nutzt v2, die benötigten Optionen sind laut Typdefinitionen vorhanden (Review S7, S8). **Entscheidung laut Review: v2.** Spec-Text in v0.4 anpassen. Fallback v1.32.x (`StreamableHTTPServerTransport`, stateless) nicht weiter ausgeführt.
2. **Spec-Revision und Zustandslosigkeit:** 2026-07-28 ist zustandslos (kein `initialize`-Zwang, keine `Mcp-Session-Id`, kein GET-Stream). `createMcpHandler` bedient 2025-11-25-Clients standardmäßig zustandslos (`legacy: 'stateless'`, GET/DELETE → 405). **bestätigt 2026-11-04:** Spec-Zeile "Session-ID im Header" (P0-1) gilt nicht; Gateway ist zustandslos; `legacy: 'stateless'` statt `'reject'` (das Doku-Beispiel nutzt `reject`, würde 2025er-Clients aussperren; mit echtem Claude Code in Aufgabe 7 bestätigen). Sessionful-Legacy nur, wenn ein Zielclient es nachweislich braucht.
3. **`list_changed` (ersetzt die frühere Annahme "kein Push"):** Für 2026-07-28-Clients gibt es `subscriptions/listen`; `createMcpHandler` liefert `bus` und `notify` (Rückgabe `{ fetch, close, notify, bus }`, Review S8). 0b baut den Pfad ein (Aufgabe 8), Phase 1 löst ihn beim Deaktivieren/Toggle aus. **Mandantentrennung:** `notify` geht an alle offenen Listen-Streams **eines Handlers**. Deshalb nicht ein globaler Handler, sondern **ein Handler je Nutzer** (Standard) oder ein nach `userId` filternder Bus (Variante B, Entscheidung im Spike von Aufgabe 8). 2025er-Clients: kein Push, akzeptiert.
4. **Plugin-Wahl Better Auth:** `mcp()` aus `@better-auth/mcp` (ersetzt `oauthProvider()`, nicht beide registrieren; das ältere `mcp`-Plugin aus `better-auth/plugins` nicht verwenden, Status unverifiziert). `jwt()` ist Pflicht. Das `admin()`-Plugin kommt aus 0a (Migration 0000).
5. **DCR vs. CIMD:** Annahme laut Review (bestätigt 2026-11-04): DCR ist Pflicht in 0b, `@better-auth/cimd` ist nicht im Scope. In A1/A2 beobachten, ob Claude Code oder Cursor CIMD bevorzugen. Allowlist-Logik so bauen, dass sie später auch für CIMD-`client_id`-Hosts greift.
6. **Widerruf von JWT-Access-Tokens:** Laut Doku serverseitig nicht widerrufbar; ein deaktivierter Client lässt bestehende JWTs bis zum Ablauf gültig. **Entscheidung (bestätigt 2026-11-04, Review B11):** Access-Token-TTL kurz (5 min, `accessTokenExpiresIn: 300`) **plus** DB-Prüfung bei **jedem** Request (Aufgabe 6), die für noch gültige JWT **und** für Refresh-Token-Zustand gilt: Nutzer aktiv, Client aktiv, Consent vorhanden **und** mindestens ein nicht widerrufener, nicht abgelaufener Refresh-Token für (Nutzer, Client). Eine Abweichung "≤ 5 min" wird bewusst nicht akzeptiert (eine Query mehr).
7. **Access-Token-Format ohne `resource`:** Mit `resource` im Request steht der Wert in `aud`; ohne ist das Token opak. `mcp()` bekommt `resource` fest; Verhalten bei fehlendem Parameter wird im Spike (Aufgabe 1) getestet und notfalls per Default-Resource erzwungen (`clientRegistrationDefaultResources`, unverifiziert) oder der Request abgelehnt. Hinweis: `mcp()` schreibt beim Start Resources in die DB (`oauth_resource`, `oauth_client_resource`, Review S3).
8. **Issuer-Pfad:** Better Auth hängt am `basePath` (`/api/auth`). Die Spec fordert `/.well-known/oauth-authorization-server` im Root. Wir liefern die Root-Routen als dünne Nitro-Routen, die an `auth.handler` bzw. die Plugin-Helfer (`oauthProviderAuthServerMetadata(auth)`) durchreichen, kein eigener JSON-Bau (Review B13). Alternative `basePath` so wählen, dass Issuer = `BASE_URL`: Entscheidung in Aufgabe 1 anhand der tatsächlichen Ausgabe.
9. **Nitro-Anbindung:** geklärt (Review S5): `toWebRequest(event)` (h3 v1, Nuxt 4.6.4). Offen nur, ob eine Web-`Response` (inkl. Streaming für `subscriptions/listen`) direkt aus dem h3-1.15-Handler zurückgegeben werden kann; Mini-Test in Aufgabe 7 (Fallback `sendWebResponse`).
10. **Scopes:** `openid offline_access mcp:tools` (bestätigt 2026-11-04). Einheitlicher Name `mcp:tools` (Review-Entscheidung, nicht `mcp`; die UI-Entwürfe zeigten `mcp`, das Frontend übernimmt `mcp:tools`). `mcpwarden:admin` (P0-12) ist in 0b **nicht wirksam**: weder in `scopes`/`scopes_supported` noch in `consent-info`. Der Name ist reserviert. **Bestätigt 2026-11-04:** Ab Phase 2 kann der Nutzer `mcpwarden:admin` beim Zustimmen separat abwählen (zwei Schalter; der Consent-Aufruf übergibt die Teilmenge der Scopes). In 0b liefern die Consent-Daten den Admin-Scope nur, wenn er aktiviert ist; bis Phase 2 bleibt er ausgeblendet.
11. **Tabellen und Namen:** Keine Präfixe (`mcpw_` entfällt), konsistent zu Better Auth. Eine Einstellungstabelle `app_setting` (0b legt sie an, Phase 1 nutzt sie). Audit gehört nicht zu 0b (Phase 1 legt `audit_log` und `audit()` an).
12. **Zeitbudget/Reihenfolge der Clients:** Claude Code (localhost, HTTP erlaubt) und Cursor sind Pflicht; Claude Desktop/Web brauchen eine öffentlich erreichbare HTTPS-URL und kommen in Phase 1.4.
13. **Statuswort "Aktiv" statt Sitzungsbegriffen (bestätigt 2026-11-04, Abgleich W7):** Das Gateway ist zustandslos, es gibt keine Verbindung oder Sitzung. Die API spricht nie von "online", "Sitzung" oder "verbunden seit". Sie liefert `lastUsedAt` und das abgeleitete `active` (letzter Aufruf höchstens 5 Minuten her). Dafür schreibt der Zugriffs-Check (Aufgabe 6) je (Nutzer, Client) gedrosselt (höchstens einmal pro Minute) einen Zeitstempel. Die Anzeigewörter "Aktiv"/"Inaktiv" setzt das Frontend.
14. **Audit-Sichtbarkeit (bestätigt 2026-11-04, betrifft Phase 1):** Nutzer sehen nur eigene Audit-Einträge, Admins zusätzlich Instanzereignisse. 0b legt kein Audit an; die Schnittstelle (`audit()` und Lese-Route) gehört zu Phase 1, hier nur als Randbedingung für Abschnitt 10.

Offene Fragen an Christian (jeweils mit übernommener Empfehlung des Reviews):

- O1: Zweiter Pflichtclient Cursor (Fallback MCP Inspector)? bestätigt 2026-11-04: ja.
- O2: Access-Token-TTL 5 min, Refresh-TTL 30 Tage? bestätigt 2026-11-04: ja.
- O3: Scopes `openid offline_access mcp:tools`, `mcpwarden:admin` nur reserviert? bestätigt 2026-11-04: ja; Admin-Scope ist beim Zustimmen später separat abwählbar (Annahme 10).
- O4: DCR-Rate-Limit 5/min je IP? bestätigt 2026-11-04: ja. Wirkt nur bei aktivem Rate-Limit und korrekter Client-IP hinter dem Proxy (0a R9).
- O5: Einzel-Token-Widerruf sofort wirksam (DB-Prüfung inkl. Refresh-Token)? bestätigt 2026-11-04: ja.
- O6: Spec v0.4 (SDK-Name, zustandslos, Push über `subscriptions/listen`, Abbruchsemantik, P0-3 in 0b) vor Start von 0b? bestätigt 2026-11-04: ja; 0b startet notfalls auf Basis dieses Plans.
- O7: Test-Schalter fürs Rate-Limit (siehe Erwartung E16). bestätigt 2026-11-04: eine zusätzliche Test-ENV, Name legt 0a fest.

## 3. Erwartungen an 0a

Maßgeblich ist, was 0a laut Review-Abgleichtabelle liefert. Jede Zeile gegen den fertigen 0a-Plan prüfen und Abweichungen hier nachziehen.

| # | Erwartung | Ort/Name |
|---|---|---|
| E1 | Konfiguration über `getConfig()` aus `process.env` (kein `runtimeConfig`): `baseUrl: URL`, `betterAuthSecret`, `masterKey`, `databaseUrl?`, `dataDir`, `allowedOrigins: string[]`. ENV-Namen fix: `BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL`, `DATA_DIR`, `ALLOWED_ORIGINS` (0b braucht keine weitere ENV außer dem Test-Schalter E16) | `server/utils/config.ts` |
| E2 | DB über `getDb(): Promise<Db>` (asynchron, memoisiert, ein Client pro Prozess). Die Migration läuft **innerhalb** des memoisierten Promises genau einmal (Review B1: Nitro wartet async Plugins nicht ab). Kein `casing`-Flag, kein `withTx` | `server/db/index.ts` |
| E3 | Schema-Dateien in `server/db/schema/`, Barrel `schema/index.ts`; Better-Auth-Schema generiert in `schema/auth.ts`; eigene Tabellen als zusätzliche Dateien mit `user_id` (Text) → `user.id` | `server/db/schema/` |
| E4 | `getAuth(): Promise<Auth>` (memoisiert, wartet auf `getDb()`); Optionen in `buildAuthOptions(cfg)` | `server/auth/index.ts`, `server/auth/options.ts` |
| E5 | Catch-all `server/api/auth/[...all].ts` mit `auth.handler(toWebRequest(event))`; `basePath` `/api/auth`; `baseURL` aus `BASE_URL` | 0a Task 8 |
| E6 | Plugins werden in `buildAuthOptions` an **einer** Stelle ergänzt; 0b fügt `jwt()` und `mcp()` hinzu | `options.ts` |
| E7 | Schema-Skripte `db:schema`, `db:generate`, `db:check` (CI-Pflichtschritt, Review B23); `auth.cli.ts` setzt `baseURL` (sonst bricht die Generierung mit `mcp()` ab, Review B12). Migrationen strikt sequentiell: 0000 (0a, inkl. `admin()`), 0001 und 0002 (0b), ab 0003 Phase 1. Keine parallelen Schema-Branches | `package.json`, `scripts/gen-auth-schema.sh` |
| E8 | Tabellen `user` (IDs als **Text**), `session`, `account`, `verification`; durch `admin()` zusätzlich `user.role` (`admin`/`user`), `banned`, `ban_reason`, `ban_expires` (Migration 0000) | `server/db/schema/auth.ts` |
| E9 | Erster Nutzer bekommt `role=admin`; Registrierung danach gesperrt, Sign-up serialisiert über einen prozessweiten Mutex (Review B3). Weitere Nutzer in Tests über `auth.api.createUser` des Admin-Plugins | `options.ts` |
| E10 | Seiten `/login` und `/register` (nicht `/sign-in`) samt Auth-Middleware gehören dem Frontend (Frontend-Plan Aufgabe 6/7), nicht 0a und nicht 0b. 0b braucht von 0a nur die API unter `/api/auth/*`; die signierte Query, die das Plugin an `loginPage`/`consentPage` hängt, muss das Frontend erhalten (Übergabe in Aufgabe 4) | `app/**` (Frontend) |
| E11 | Server-Helper `requireUser(event) → { user, session }` und `requireAdmin(event)` (403 für Nicht-Admins) in einer Datei. 0b ruft `requireAdmin` für jede Admin-Route auf | `server/utils/session.ts` |
| E12 | Sperren eines Nutzers über `admin()` (`banned`, `ban_expires`) beendet Sessions; der Zustand ist per DB abfragbar. Der vollständige Lebenszyklus (`user-lifecycle.ts`, Widerruf von OAuth-/PAT-Zugriffen beim Sperren, Löschen) ist Phase 1; 0b deckt Sperren/Löschen durch den Zugriffs-Check pro Request ab | `user.banned` |
| E13 | Test-Harness aus 0a für alle Phasen: Ordner `tests/`, gebautes Artefakt als Kindprozess (`.output/server/index.mjs`), `TEST_BACKEND=pglite|postgres`, `TEST_PG_ADMIN_URL`, `startServer(env)`, `api()`-Helfer mit Cookie-Jar, Helfer `createUser()` (Admin-API). Kein `@nuxt/test-utils` | `tests/integration/harness.ts` |
| E14 | Entfällt für 0b: UI-Komponenten und Layouts (inkl. Admin-Layout) liefert das Frontend. 0b legt nichts unter `app/**` an | – |
| E15 | Keine Krypto-Hilfen für 0b nötig (PAT-Hash per SHA-256). Schlüsselableitung (`deriveUserKey`, `decryptSecret`) liegt später in `server/gateway/crypto/secrets.ts` (Phase 1); 0b legt kein `crypto.ts` an | – |
| E16 | Better-Auth-Rate-Limit ist aktiv im Build (Produktion); es gibt eine Test-ENV (Name legt 0a fest, z. B. `RATE_LIMIT=off`), damit viele Sign-ins je Test nicht in 429 laufen; für den DCR-Rate-Limit-Test wird es in einem eigenen Lauf eingeschaltet (Review B16) | `options.ts`, Harness |
| E17 | `/healthz` und `/readyz` existieren; 0b ändert sie nicht | 0a |
| E18 | Init-Plugin `server/plugins/00-init.ts` startet nur `getDb().catch(exit(1))`; `/readyz` bleibt (Review B1) | 0a Task 7 |
| E19 | Einheitliche Fehlerform der eigenen Routen über h3-`createError`: `{ statusCode, statusMessage, data: { code, field?, message } }` (Wunsch E10 des Frontend-Plans). Falls 0a eine andere Form festlegt, gilt 0a, und `ApiErrorBody` in `shared/api-types.ts` folgt ihr | `shared/api-types.ts` |
| E20 | `shared/api-types.ts` (Erstfassung vom Frontend, Regeln dort Abschnitt 4: nur Typen, ISO-8601-Strings, `Ms`-Suffix, nie Secrets, Importalias `#shared/api-types`). 0b ergänzt die Typen aus Abschnitt 4.1 im selben Commit wie die jeweilige Route. Fehlt die Datei noch, legt 0b sie mit genau diesen Typen an | `shared/api-types.ts` |

Abweichungen kosten vor allem in Aufgabe 1 (Plugin-Einbau, Schema) und beim Test-Harness. Alles, was 0b selbst anlegt, liegt in eigenen Dateien, damit keine Kollisionen mit 0a entstehen.

## 4. Dateien und Pfade

Neu (Pfade relativ zum Repo-Root; Nuxt 4, `server/` Nitro; `app/**` gehört dem Frontend und wird von 0b nicht angelegt oder geändert):

```
server/auth/mcp-plugin.ts            Plugin-Konfiguration (mcp(), jwt()), Scopes, Resource
server/auth/dcr-policy.ts            DCR-Policy + Allowlist-Matcher (rein, testbar)
server/auth/dcr-hook.ts              Anbindung an /oauth2/register (clientPrivileges/Hook oder Nitro-Middleware)
server/auth/client-meta.ts           Verfall-Aufräumen für OAuth-Clients, Ableitung von lastUsedAt/active/expiresAt
server/auth/access-guard.ts          authenticateMcpRequest(): Token prüfen + DB-Zusatzprüfung pro Request
server/auth/auth-context.ts          Typ AuthContext + Mapper aus Token/PAT
server/auth/pat.ts                   PAT erzeugen/verifizieren/widerrufen
server/db/schema/mcp.ts              app_setting, dcr_allowlist, oauth_client_meta, oauth_connection_use, personal_access_token
server/db/migrations/…               generierte Migrationen: 0001 (OAuth-Tabellen aus Better Auth), 0002 (eigene Tabellen)
server/api/admin/oauth/policy.get.ts / policy.put.ts                 DCR-Modus lesen/setzen (requireAdmin)
server/api/admin/oauth/allowlist.get.ts / allowlist.post.ts / allowlist/[id].delete.ts / allowlist/reset-builtins.post.ts
server/api/admin/oauth/clients.get.ts / clients/[id].patch.ts / clients/[id].delete.ts   Clients auflisten/deaktivieren/widerrufen
server/api/oauth/consent-info.get.ts                 Client-Infos + Allowlist-Status für die Consent-Seite (Frontend)
server/api/me/pats.get.ts / pats.post.ts / pats/[id].delete.ts       PAT-Endpunkte
server/api/me/connections.get.ts / connections/[clientId].delete.ts  Clients des Nutzers (Consents) + Widerruf
shared/api-types.ts                  Beitrag: Typen aller obigen Routen (Abschnitt 4.1)
server/routes/mcp.ts                 /mcp (POST; GET/DELETE → 405)
server/routes/.well-known/oauth-protected-resource.get.ts
server/routes/.well-known/oauth-protected-resource/mcp.get.ts
server/routes/.well-known/oauth-authorization-server.get.ts
server/routes/.well-known/oauth-authorization-server/[...path].get.ts   (falls Issuer mit Pfad)
server/mcp/handler.ts                Handler je Nutzer (createMcpHandler), Gate-Reihenfolge, Origin-Check
server/mcp/notify.ts                 notifyToolsChanged(userId), closeUserStreams(userId), Stream-Höchstlaufzeit
server/mcp/dummy-upstream.ts         Dummy-Upstream (echo, add, slow_echo, whoami, toggle_tool)
server/mcp/upstream-port.ts          ToolSource-Schnittstelle für Phase 1 (siehe Abschnitt 10)
server/mcp/errors.ts                 401/403-Antworten mit WWW-Authenticate
tests/integration/oauth/…            Flow-Tests (siehe 6)
tests/integration/api/…              Routen- und Formtests der Self-Service- und Admin-Routen
tests/integration/mcp/…              Endpoint-Tests
tests/unit/dcr-policy.test.ts        Matcher-Tabelle
tests/helpers/oauth-client.ts        Minimaler OAuth-Testclient (fetch-basiert, PKCE)
docs/manual-tests/phase-0b.md        Abnahme-Protokoll (Datei wird beim Abnahmelauf angelegt)
```

Ändern: `server/auth/options.ts` (Plugins `jwt()`, `mcp()` ergänzen, Rate-Limit-Regeln), `server/auth/auth.cli.ts` (`baseURL`, neue Plugins), `server/db/schema/index.ts` (Barrel), `package.json`, `README.md` (Abschnitt "Client verbinden"). `.env.example` ändert sich nicht (`ALLOWED_ORIGINS` kommt aus 0a); nur falls 0a einen Test-Schalter (E16) einführt, ist dieser dort dokumentiert.

Neue Abhängigkeiten: `@better-auth/mcp`, `@modelcontextprotocol/server`, `zod` (falls nicht vorhanden); Dev: `@modelcontextprotocol/client` (Testclient). `@better-auth/oauth-provider` kommt vermutlich als Abhängigkeit von `@better-auth/mcp` (beim Installieren prüfen). Versionen exakt pinnen.

### 4.1 Routen und Antwortformen (Vertrag mit dem Frontend)

Alle Routen verlangen eine Session (`requireUser`; ohne Session 401), die `/api/admin/*`-Routen zusätzlich `requireAdmin` (Nicht-Admin 403). Jede Abfrage filtert nach der `userId` der Session; fremde IDs liefern 404, nie 403. Zeitstempel sind ISO-8601-Strings, Mengen sind unpaginierte Listen `{ items: [...] }` (kleine Datenmengen; 0b definiert kein Paging). Fehler haben die Form `ApiErrorBody` (E19). Die Tabelle gleicht den Datenbedarf aus `docs/ui-abgleich.md` Abschnitt 5 ab; Abweichungen stehen unter der Tabelle.

| Route | Zweck / Bildschirm | Anfrage | Antwort (Erfolg) | Fehler (`data.code`) |
|---|---|---|---|---|
| `GET /api/oauth/consent-info` | Consent | Query = die vom Plugin angehängte signierte Query, unverändert durchgereicht | 200 `ConsentInfo` | 400 `invalid_consent_query` (Signatur/Frist), 404 `client_not_found` |
| `GET /api/me/pats` | Tokens | – | 200 `PatList` | – |
| `POST /api/me/pats` | Tokens (Erzeugen) | `{ name }` | 201 `PatCreated` | 400 `invalid_name`, 409 `pat_limit_reached` |
| `DELETE /api/me/pats/:id` | Tokens (Widerruf) | – | 204 (idempotent, auch bei bereits widerrufenem PAT) | 404 `not_found` |
| `GET /api/me/connections` | Clients | – | 200 `ConnectionList` | – |
| `DELETE /api/me/connections/:clientId` | Clients (Widerruf) | – | 204 | 404 `not_found` (kein Consent dieses Nutzers) |
| `GET /api/admin/oauth/policy` | Admin Clients (DCR) | – | 200 `DcrPolicy` | – |
| `PUT /api/admin/oauth/policy` | Admin Clients (DCR) | `{ mode }` | 200 `DcrPolicy` | 400 `invalid_mode` |
| `GET /api/admin/oauth/allowlist` | Admin Clients (DCR) | – | 200 `AllowlistList` | – |
| `POST /api/admin/oauth/allowlist` | Eintrag hinzufügen | `AllowlistInput` | 201 `AllowlistEntry` | 400 `invalid_entry` (mit `field`) |
| `DELETE /api/admin/oauth/allowlist/:id` | Eintrag entfernen | – | 204 | 404 `not_found` |
| `POST /api/admin/oauth/allowlist/reset-builtins` | Vorbelegung wiederherstellen | – | 200 `AllowlistList` | – |
| `GET /api/admin/oauth/clients` | Registrierte Clients | – | 200 `OAuthClientAdminList` | – |
| `PATCH /api/admin/oauth/clients/:id` | Client deaktivieren/aktivieren | `{ disabled }` | 200 `OAuthClientAdmin` | 404 `not_found` |
| `DELETE /api/admin/oauth/clients/:id` | Client widerrufen (löscht Client samt Consents und Tokens) | – | 204 | 404 `not_found` |

Typen (Beitrag zu `shared/api-types.ts`; Namen sind verbindlich, Felder dürfen nur abwärtskompatibel wachsen):

```ts
export type DcrMode = 'off' | 'allowlist' | 'open';
export type DcrPolicy = { mode: DcrMode };               // Standard 'open'

// Consent: Name, Redirect-URIs, Allowlist-Status, Scopes (ohne Titel, Titel stehen im Frontend)
export type ConsentRedirect = { uri: string; host: string; loopback: boolean };
export type ConsentScope = { name: string; required: boolean };
export type ConsentInfo = {
  client: {
    id: string;
    name: string;                  // untrusted, auf 80 Zeichen gekürzt, nur als Text rendern
    redirects: ConsentRedirect[];
    allowlisted: boolean;          // live gegen die aktuelle Allowlist berechnet
    registeredAt: string;
    viaDcr: boolean;
  };
  scopes: ConsentScope[];          // 'mcp:tools' required:true; 'openid'/'offline_access' required:true; 'mcpwarden:admin' nur, wenn aktiviert (in 0b nie)
  resource: string;                // BASE_URL + '/mcp'
  loopback: boolean;               // mindestens eine Redirect-URI ist Loopback (Zusatzwarnung)
};

// PATs: Klartext nur in PatCreated.token
export type PatSummary = {
  id: string; name: string;
  prefix: string;                  // 'mcpw_pat_' + 4 Zeichen (Abgleich W13)
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
};
export type PatList = { items: PatSummary[]; limit: { max: number; active: number } };  // max = 20
export type PatCreated = PatSummary & { token: string };
export type PatCreateInput = { name: string };          // 1 bis 64 Zeichen

// Clients des Nutzers (UI-Wort "Clients", Pfad bleibt "connections")
export type ConnectionSummary = {
  clientId: string; name: string;
  scopes: string[]; redirectHost: string;
  allowlisted: boolean;
  grantedAt: string;
  lastUsedAt: string | null;       // letzter Aufruf auf /mcp, gedrosselt auf 1 min genau
  active: boolean;                 // lastUsedAt höchstens 5 min her; Anzeige "Aktiv"/"Inaktiv" im Frontend
};
export type ConnectionList = { items: ConnectionSummary[] };

// Admin: Allowlist und Registrierungen
export type AllowlistEntry = {
  id: string; label: string; namePattern: string;
  redirectPatterns: string[]; builtin: boolean; createdAt: string;
};
export type AllowlistInput = Pick<AllowlistEntry, 'label' | 'namePattern' | 'redirectPatterns'>;
export type AllowlistList = { items: AllowlistEntry[] };
export type OAuthClientAdmin = {
  id: string; name: string; redirectUris: string[];
  createdAt: string; lastUsedAt: string | null;
  userCount: number;               // Anzahl Consents
  allowlisted: boolean;            // live berechnet
  registeredVia: 'dcr' | 'admin';
  disabled: boolean;
  expiresAt: string | null;        // createdAt + 30 Tage, solange nie genutzt; sonst null ("Verfall in 24 Tagen" rechnet das Frontend aus)
};
export type OAuthClientAdminList = { items: OAuthClientAdmin[] };
```

Abweichungen und Festlegungen gegenüber dem Abgleich (Abschnitt 5):

- **Geräte** (`MacBook Pro` u. ä.) liefert 0b nicht: DCR und PAT kennen kein Gerät (Abgleich Punkt 3). Das Frontend zeigt Name, Redirect-Host und Zeiten.
- **Scopes mit Titel:** `consent-info` liefert nur die Roh-Namen. Der Frontend-Plan (E4) wünscht Titel; die Titel stehen in der Label-Tabelle des Frontends (Abgleich W2). Falls das Frontend Titel vom Server will, ergänzt es `title` abwärtskompatibel.
- **Zustimmung** läuft nicht über eine eigene Route, sondern über das Better-Auth-Clientplugin (`oauth2.consent({ accept, scope })`). `scope` ist eine Teilmenge der angebotenen Scopes; ab Phase 2 wählt der Nutzer damit `mcpwarden:admin` ab. Der Server akzeptiert keine Teilmenge ohne `mcp:tools`.
- **PAT-Anzeigepräfix** wird auf `mcpw_pat_` plus 4 Zeichen gesetzt (Abgleich W13); der Hash bleibt SHA-256 über den vollständigen Token.
- **Abruf:** Das Frontend ruft alle diese Routen nur auf dem Client ab (Frontend A5). 0b setzt `Cache-Control: no-store` auf die Listen.
- **Audit:** keine 0b-Route (siehe Abschnitt 9 und 10).

## 5. Aufgaben

Reihenfolge ist verbindlich; nach jeder Aufgabe ein grüner Zwischenstand. Pro Aufgabe zuerst den Test schreiben, soweit sinnvoll. Schemaänderungen strikt sequentiell (Migration 0001 in Aufgabe 1, 0002 in Aufgabe 3); `db:check` läuft in jeder Aufgabe mit Schemaänderung.

### Aufgabe 1: Better Auth als OAuth-Provider einbinden (Spike inklusive)

- **Zweck:** Auth-Server-Endpunkte, Schema und Konfiguration stehen. Zugleich Klärung der offenen Punkte 6 bis 8 aus Abschnitt 2.
- **Dateien:** `server/auth/mcp-plugin.ts`, `server/auth/options.ts`, `server/auth/auth.cli.ts`, `package.json`, generiertes Schema/Migration 0001.
- **Schritte:**
  1. Pakete installieren (Abschnitt 4).
  2. In `buildAuthOptions` (`options.ts`): `jwt()` und `mcp({ loginPage: "/login", consentPage: "/consent", resource: \`${baseUrl}/mcp\`, scopes: ['openid', 'offline_access', 'mcp:tools'], accessTokenExpiresIn: 300 })` ergänzen (`mcpwarden:admin` bleibt außen vor, Annahme 10). `admin()` bleibt aus 0a. Falls `/token` des JWT-Plugins kollidiert: `disabledPaths: ["/token"]` (Auswirkung prüfen).
  3. `allowDynamicClientRegistration: true` und `allowUnauthenticatedClientRegistration: true` (anonyme DCR; Policy-Gate in Aufgabe 3). `clientRegistrationDefaultApplicationType: "infer"` (Cursor-Hinweis der Doku).
  4. `auth.cli.ts`: `baseURL` setzen; Schema generieren (`pnpm db:schema`), Migration `pnpm db:generate --name oauth` (0001). Erwartete Tabellen (Review S3): `jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `oauth_client_assertion`. Migration einchecken; Neustart und Postgres-Lauf prüfen.
  5. Spike-Fragen klären: (a) tatsächliche Endpunktpfade und Issuer; (b) Token-Format (JWT/opak) mit und ohne `resource`, Claims (`sub`, `aud`, `scope`, `azp`/`client_id`, `sid`); (c) greift `clientPrivileges` (kann `create` verweigern) bei anonymer DCR? Dann ist das das bevorzugte Policy-Gate (Review B14); (d) Existenz eines `before`-Hooks für `/oauth2/register`; (e) Schema der Refresh-Token-Tabelle (Spalten für Widerruf/Ablauf; Grundlage von Aufgabe 6); (f) Verhalten von `mcp()` beim Start (schreibt Resources in die DB) mit dem memoisierten `getAuth()` aus 0a.
  6. Ergebnisse als Kommentar oben in `mcp-plugin.ts` und in Abschnitt 2 dieses Plans nachtragen.
- **Prüfung:** `GET <BASE_URL>/api/auth/.well-known/oauth-authorization-server` (oder tatsächlicher Pfad) liefert `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, `jwks_uri`. `POST /api/auth/oauth2/register` mit Beispielmetadaten liefert `client_id`.
- **DoD:** Migration 0001 eingecheckt; App startet auf PGlite und Postgres; Spike-Befunde dokumentiert; Punkte 6 bis 8 entschieden.

### Aufgabe 2: Discovery-Endpunkte und WWW-Authenticate

- **Zweck:** Clients finden den Auth-Server (RFC 9728, RFC 8414).
- **Dateien:** `server/routes/.well-known/*`, `server/mcp/errors.ts`.
- **Schritte:**
  1. `/.well-known/oauth-protected-resource` und `/.well-known/oauth-protected-resource/mcp`: Plugin-Helfer bzw. `auth.handler` durchreichen statt JSON selbst zu bauen (Review B13); nur falls das Plugin keinen passenden Handler offenlegt, selbst bauen (SDK-Helfer `oauthMetadataResponse`). Inhalt: `resource` = `${BASE_URL}/mcp`, `authorization_servers`, `scopes_supported`, `bearer_methods_supported: ["header"]`.
  2. `/.well-known/oauth-authorization-server` im Root: `oauthProviderAuthServerMetadata(await getAuth())` in eine Nitro-Route hängen; bei Issuer mit Pfad zusätzlich die Pfadvariante und ggf. `openid-configuration`.
  3. `errors.ts`: `unauthorized(request, {error?, scope?})` baut `401` mit `WWW-Authenticate: Bearer resource_metadata="<BASE_URL>/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"`; `forbidden` für `insufficient_scope` (403). Header-Wert exakt nach MCP-Spec.
  4. URLs immer aus `BASE_URL` (`getConfig()`), nie aus dem `Host`-Header oder `X-Forwarded-*`.
- **Prüfung:** Contract-Test: JSON-Felder, `Content-Type: application/json`, CORS-Header auf Well-known-Routen (`Access-Control-Allow-Origin: *`, GET/OPTIONS; Metadaten sind öffentlich).
- **DoD:** Beide Discovery-Dokumente stimmen mit den tatsächlichen Endpunkten überein; Test grün.

### Aufgabe 3: DCR-Policy, Allowlist, Client-Verwaltung (Admin-API)

- **Zweck:** P0-2 DCR-Policy mit drei Modi, Allowlist, Admin-Routen, Verfall. Steht vor der Consent-API, weil diese den Matcher nutzt. Die Admin-Seite `/admin/oauth` baut das Frontend (Frontend-Plan Aufgabe 9) gegen die Routen aus Abschnitt 4.1.
- **Dateien:** `server/db/schema/mcp.ts`, `server/auth/dcr-policy.ts`, `dcr-hook.ts`, `client-meta.ts`, `server/api/admin/oauth/*`, Typbeitrag in `shared/api-types.ts` (`DcrMode`, `DcrPolicy`, `AllowlistEntry`, `AllowlistInput`, `AllowlistList`, `OAuthClientAdmin`, `OAuthClientAdminList`). Keine Dateien unter `app/**`.
- **Schema** (Migration 0002 über `pnpm db:generate --name oauth_admin`; eigene Tabellen ohne Präfix, Text-IDs bzw. Text-Fremdschlüssel auf `user.id`):
  - `app_setting(key text pk, value jsonb, updated_at)`: die einzige Einstellungstabelle des Projekts (Phase 1 nutzt sie mit). Schlüssel `oauth.dcr_mode` ∈ `off|allowlist|open`, Default `open`.
  - `dcr_allowlist(id, label, name_pattern, redirect_patterns jsonb, builtin bool, created_at)`. Vorbelegung (idempotenter Seed beim ersten Zugriff, memoisiert, über `getDb()`; keine handeditierten Migrationen): Claude Code, Claude Desktop/Web, Cursor, VS Code, Windsurf, Zed, Codex. Muster z. B. `http://localhost:*`, `http://127.0.0.1:*`, `cursor://`, `vscode://`; Claude-Web-Callback-URLs sind **unverifiziert** und beim Spike nachzuschlagen.
  - `oauth_client_meta(client_id pk/fk, allowlisted bool, registered_via text ('dcr'|'admin'), created_at)`. `allowlisted` hält den Stand bei der Registrierung; die API-Felder `allowlisted` berechnen den Matcher live gegen die aktuelle Allowlist. Kein `last_used_at` hier, es wird aus `oauth_connection_use` abgeleitet.
  - `oauth_connection_use(user_id text fk→user on delete cascade, client_id fk, last_used_at, pk(user_id, client_id))`: Zeitpunkt des letzten `/mcp`-Aufrufs je (Nutzer, Client), geschrieben vom Zugriffs-Check (Aufgabe 6, gedrosselt auf 1 min). Quelle für `lastUsedAt`/`active` in `ConnectionSummary` und `OAuthClientAdmin`.
- **Schritte:**
  1. `dcr-policy.ts`: reine Funktionen `evaluateRegistration(mode, allowlist, metadata) → {allow, allowlisted, reason}` und `matchesAllowlist(entry, name, redirectUris)`. Regeln: `https` oder Loopback (`http://localhost`, `127.0.0.1`, `[::1]`) oder registrierte App-Schemes; keine Wildcards außerhalb der Allowlist-Muster; `:*` meint beliebigen Port. `javascript:`, `data:` u. ä. immer ablehnen. `client_name` ist untrusted (Länge begrenzen, nur Text rendern).
  2. `dcr-hook.ts`: Gate vor `POST /api/auth/oauth2/register`. Reihenfolge der Varianten laut Spike (Aufgabe 1): (1) `clientPrivileges`, (2) Better-Auth-Hook `hooks.before` mit Pfadmatch, (3) Fallback Nitro-Middleware vor dem Catch-all, die den Body liest, Policy anwendet und den Request mit neu erzeugtem Body (`new Request`) an `auth.handler` übergibt. Modus `off`: 403 mit RFC-7591-konformer Fehlerantwort; `allowlist` + nicht gelistet: 400 `invalid_client_metadata`/`invalid_redirect_uri`. Nach Erfolg Zeile in `oauth_client_meta` (`allowlisted`).
  3. Rate-Limit `/oauth2/register`: Better-Auth-`rateLimit.customRules` (Doku-Default 5/min je IP), Test mit eingeschaltetem Limit (E16).
  4. `lastUsedAt` (Client-Ebene) = Maximum von `oauth_connection_use.last_used_at` über alle Nutzer des Clients; kein Hook nach `/oauth2/token`.
  5. Verfall: nie genutzte Registrierungen (kein Eintrag in `oauth_connection_use`) älter als 30 Tage löschen (täglicher Task; Nitro `scheduledTasks` experimentell, sonst `setInterval` in einem Plugin, Single-Instance genügt; Zeit im Test mockbar). `OAuthClientAdmin.expiresAt` = `createdAt + 30 Tage`, solange der Client nie genutzt wurde, sonst `null`.
  6. Admin-Routen nach Abschnitt 4.1: `policy` (lesen/setzen), `allowlist` (lesen, hinzufügen, entfernen, `reset-builtins`), `clients` (lesen mit `userCount` aus `oauth_consent`, `PATCH {disabled}` über `adminUpdateOAuthClient`, `DELETE` = Widerruf mit Löschen von Client, Consents und Tokens; bestehende JWTs enden dank Aufgabe 6 sofort und `closeUserStreams` für betroffene Nutzer, sobald vorhanden). Den Hinweistext, die Allowlist sei "Komfort/Warnlogik, kein Sicherheitsmerkmal", zeigt das Frontend; die API liefert nur Daten.
  7. **Alle** Admin-Routen rufen `requireAdmin(event)` aus 0a (E11) auf; eine Seiten-Middleware des Frontends ist nur Komfort, die Server-Prüfung ist maßgeblich. Admin sieht nur Metadaten.
- **Prüfung:** Unit-Tests der Matcher-Tabelle (u. a. `http://evil.com`, `http://localhost.evil.com`, `cursor://` ohne Pfad, IPv6-Loopback, Userinfo in URL); Integrationstests der drei Modi gegen `/oauth2/register`; Formtests der Admin-Routen gegen die Typen aus Abschnitt 4.1 (Schlüssel, Typen, `expiresAt`-Regel); Nicht-Admin und anonyme Aufrufe der Admin-Routen → 403/401.
- **DoD:** Alle drei Modi wirken; Standard `open`; Allowlist geseedet; alle Admin-Routen liefern die vertraglichen Formen und sind nur für Admins erreichbar; Löschtask getestet; Typen in `shared/api-types.ts`.

### Aufgabe 4: Consent-API und Übergabe für Login-Weiterleitung

- **Zweck:** Das Frontend kann Zustimmung und Ablehnung darstellen; unbekannte Clients sind in den Daten markiert. Login-, Registrierungs- und Consent-Seite (inkl. Warnbox, Pflicht-Häkchen, Loopback-Zusatzwarnung, Scope-Schalter) baut das Frontend (Frontend-Plan Aufgabe 7); 0b liefert Route, Datenform und Tests.
- **Dateien:** `server/api/oauth/consent-info.get.ts`, Typbeitrag in `shared/api-types.ts` (`ConsentInfo`, `ConsentRedirect`, `ConsentScope`), Kommentarblock "Übergabe Frontend" in `server/auth/mcp-plugin.ts`. Keine Dateien unter `app/**`.
- **Schritte:**
  1. `consent-info.get.ts` (nur mit Session, sonst 401): Query mit `verifyOAuthQueryParams(query, secret)` prüfen (ungültig oder abgelaufen → 400 `invalid_consent_query`), Client öffentlich laden (`getOAuthClientPublic`; unbekannt → 404 `client_not_found`), Antwort `ConsentInfo` nach Abschnitt 4.1 bauen: `client.name` gekürzt (untrusted), `redirects` mit `host` und `loopback` je URI, `loopback` gesamt (Zusatzwarnung laut MCP-Spec zu Loopback-Redirects, nicht aus `spec.md`), `allowlisted` live über den Matcher aus Aufgabe 3, `registeredAt`/`viaDcr` aus `oauth_client_meta`, `resource` aus `BASE_URL`.
  2. `scopes`: die angeforderten Scopes, gefiltert auf die bekannten (`openid`, `offline_access`, `mcp:tools`), jeweils `required: true`. `mcpwarden:admin` nur, wenn er aktiviert ist; in 0b ist er es nicht, die Daten enthalten ihn also nie (bestätigt 2026-11-04, Annahme 10). Ab Phase 2 wird er mit `required: false` ausgeliefert, damit das Frontend ihn als zweiten Schalter anbietet.
  3. Zustimmung geht nicht über diese Route, sondern über `authClient.oauth2.consent({ accept, scope })` (Better-Auth-Clientplugin). Server-Anforderung: eine Teilmenge ohne `mcp:tools` wird abgelehnt; Ablehnen führt zum Redirect mit `error=access_denied` (Plugin). Im Spike (Aufgabe 1) prüfen, ob eine Teilmenge im `scope`-Parameter vom Plugin akzeptiert wird (Grundlage für Phase 2).
  4. **Übergabe Frontend** (als Kommentar in `mcp-plugin.ts`, Ergebnis des Spikes aus Aufgabe 1): welche signierte Query das Plugin an `loginPage` und `consentPage` hängt, dass die Seiten sie unverändert erhalten müssen (auch über den Redirect der Auth-Middleware auf `/login`, 0b R14), und welcher Clientplugin-Aufruf nach dem Login den Authorize-Flow fortsetzt (`oauthProviderClient()`, Details im Spike).
- **Prüfung:** Formtest von `consent-info` (bekannter Client `allowlisted:true`, unbekannter `false`, Loopback-Flag, ungültige Signatur 400, ohne Session 401, Scope-Liste ohne `mcpwarden:admin`); der Gesamtablauf im Flow-Test (Aufgabe 9).
- **DoD:** `consent-info` liefert die vertragliche Form; die Übergabenotiz steht im Code; Typen in `shared/api-types.ts`.

### Aufgabe 5: Personal Access Tokens und Clients des Nutzers (API)

- **Zweck:** P0-3 (nach Review B18 in 0b, nicht Phase 1) und User Story "Clients widerrufen". Steht vor dem Guard, der PATs prüft. Die Seiten `/settings/tokens` (Dialog "Token benennen", einmalig sichtbarer Klartext mit Kopieren, Leerzustand, Limit-Hinweis) und `/settings/connections` (UI-Wort "Clients", Bestätigung vor Widerruf) baut das Frontend (Frontend-Plan Aufgabe 8).
- **Dateien:** `server/auth/pat.ts`, `server/api/me/pats.get.ts`, `pats.post.ts`, `pats/[id].delete.ts`, `server/api/me/connections.get.ts`, `connections/[clientId].delete.ts`, Typbeitrag in `shared/api-types.ts` (`PatSummary`, `PatList`, `PatCreated`, `PatCreateInput`, `ConnectionSummary`, `ConnectionList`); Tabelle `personal_access_token` in `schema/mcp.ts` (Migration 0002, Aufgabe 3). Keine Dateien unter `app/**`.
- **Schritte:**
  1. Tabelle `personal_access_token(id uuid pk, user_id text fk→user on delete cascade, name, token_hash unique, prefix, created_at, last_used_at, revoked_at)`; `prefix` ist der Anzeigepräfix `mcpw_pat_` plus 4 Zeichen (13 Zeichen, Abgleich W13).
  2. Erzeugen (`POST /api/me/pats`): `mcpw_pat_` + 32 zufällige Bytes base64url (`crypto.randomBytes`), Klartext nur in der Antwort `PatCreated.token`; Name Pflicht (1 bis 64 Zeichen, sonst 400 `invalid_name`); Obergrenze 20 aktive PATs je Nutzer (Konstante, sonst 409 `pat_limit_reached`).
  3. Liste (`GET /api/me/pats`): `PatList` mit allen PATs des Nutzers (auch widerrufene, erkennbar an `revokedAt`) und `limit { max, active }`. Widerruf (`DELETE`): `revoked_at` setzen (Zeile bleibt, Audit-Tabelle kommt erst in Phase 1), idempotent, `closeUserStreams(userId)` sobald vorhanden. **Jede** Query filtert nach `user_id` aus der Session. Alle Routen über `requireUser`.
  4. Clients des Nutzers (`GET /api/me/connections`): Consents des Nutzers als `ConnectionSummary` (Client-Name, `redirectHost`, `scopes`, `grantedAt`, `allowlisted`, `lastUsedAt` aus `oauth_connection_use`, `active` = höchstens 5 min her). Keine Begriffe wie "Sitzung" oder "online" (Annahme 13). Widerruf (`DELETE …/:clientId`) = `deleteOAuthConsent` plus Löschen der Refresh-/Access-Tokens dieses Clients für diesen Nutzer (laut Doku löscht Refresh-Revoke die abgeleiteten Access-Tokens; Verhalten testen) und `closeUserStreams(userId)` (Aufgabe 8, sobald vorhanden); ohne Consent dieses Nutzers 404.
  5. `Cache-Control: no-store` auf allen Listen; kein Klartext in Logs.
- **Prüfung:** Nutzer B (per `createUser()` angelegt) kann PAT/Consent von A weder sehen noch widerrufen (404); Klartext steht nicht in DB und Logs (Test greift Tabelle und Log-Ausgabe ab) und nur in der POST-Antwort, nie in GET; Formtests gegen die Typen aus Abschnitt 4.1 (u. a. Präfixlänge 13, `limit.max` 20, 21. PAT → 409).
- **DoD:** Routen für PATs und Clients liefern die vertraglichen Formen; Isolationstest grün; Typen in `shared/api-types.ts`. Der `/mcp`-Nachweis (A7) folgt in Aufgabe 7.

### Aufgabe 6: Token-Verifikation, Audience und Zugriffsprüfung

- **Zweck:** P0-2 Audience-Bindung und **sofortiger Widerruf**; einheitlicher `AuthContext` für OAuth-Tokens und PATs.
- **Dateien:** `server/auth/access-guard.ts`, `auth-context.ts`.
- **Schritte:**
  1. Bearer aus `Authorization` lesen (nie aus der Query). Präfix `mcpw_pat_` → PAT-Pfad; sonst OAuth-Pfad.
  2. Spike-Entscheidung (Variante nach Aufgabe 1): `requireMcpAuth(auth, handler, { resource, requiredScopes: ["mcp:tools"], challengeScopes })` aus `@better-auth/mcp` (prüft Signatur, Issuer, Audience, Ablauf; 401 mit RFC-9728-Challenge, 403 bei fehlendem Scope) **oder** `verifyAccessTokenRequest` aus `better-auth/oauth2` mit selbst gebauten Antworten, falls wir eigene Hooks vor dem MCP-Handler brauchen. Ergebnis hier und in Abschnitt 8 festhalten.
  3. Audience-Test: `aud` ≠ `${BASE_URL}/mcp` → 401 `invalid_token`.
  4. **Zusatzprüfung bei jedem Request, auch für noch gültige JWT** (`authenticateMcpRequest`), Ergebnis wird nicht gecacht (Sofortwirkung vor Latenz; Cache mit 5-s-TTL nur falls Messung es verlangt):
     - Nutzer existiert, `banned` ist falsch bzw. `ban_expires` abgelaufen.
     - Client existiert und ist nicht `disabled`.
     - `oauth_consent` für (Nutzer, Client) vorhanden.
     - **Refresh-Token-Zustand:** Mindestens ein nicht widerrufener, nicht abgelaufener Refresh-Token für (Nutzer, Client) existiert (Review B11; fängt den Einzel-Token-Widerruf nach RFC 7009 bei bestehendem Consent ab). Bei Rotation ersetzt das neue Token das alte, die Bedingung bleibt erfüllt. Offener Punkt: Tokens ohne `offline_access` haben keinen Refresh-Token; dafür gilt nur der Consent-Check (Spike prüfen, sonst `offline_access` als Pflicht-Scope festlegen).
     - Eine (ggf. zusammengefasste) indizierte Abfrage je Request; die Nutzerzeile liefert zugleich `role` für den Kontext.
     - Nach bestandener Prüfung (OAuth-Pfad) `oauth_connection_use.last_used_at` für (Nutzer, Client) setzen, gedrosselt auf höchstens einmal pro Minute und ohne den Aufruf zu bremsen (Quelle für `lastUsedAt`/`active`, Annahme 13).
  5. PAT-Pfad: SHA-256 des Tokens (256-Bit-Zufall, kein Salt nötig) in `personal_access_token` nachschlagen: nicht widerrufen, Nutzer nicht gesperrt (gleicher Check wie oben); `last_used_at` gedrosselt (höchstens einmal pro Minute, ohne den Aufruf zu bremsen). Konstantzeit-Vergleich.
  6. `AuthContext` bauen (Abschnitt 10, inkl. `role`) und als `authInfo` ans SDK geben (`extra` trägt `userId`, `role`, `tokenType`, `tokenId`).
- **Prüfung:** abgelaufen, falsche Signatur, falsche Audience, Scope fehlt (403 `insufficient_scope`), Nutzer gesperrt, Client deaktiviert, Consent gelöscht, **nur Refresh-Token widerrufen (Consent bleibt) → sofort 401**, PAT widerrufen, Token-Passthrough-Verbot (trivial in 0b, da kein echter Upstream). Messung des Gate-Overheads (Ziel ≪ 50 ms, PGlite).
- **DoD:** Beide Tokenarten ergeben denselben `AuthContext`; Widerruf wirkt beim nächsten Request, Test belegt es ohne Warten auf Ablauf.

### Aufgabe 7: Minimaler `/mcp`-Endpoint mit Dummy-Upstream

- **Zweck:** `initialize`, `tools/list`, `tools/call` über einen Dummy-Upstream; Gate und Origin-Prüfung.
- **Dateien:** `server/routes/mcp.ts`, `server/mcp/handler.ts`, `dummy-upstream.ts`, `upstream-port.ts`.
- **Schritte:**
  1. Mini-Spike: Rückgabe einer Web-`Response` (auch gestreamt) aus dem h3-1.15-Handler; Request via `toWebRequest(event)` (geklärt). Ergebnis als Kommentar in `routes/mcp.ts`.
  2. `handler.ts`: pro Nutzer `createMcpHandler(() => buildServer(ctx), { legacy: 'stateless' })` (Aufgabe 8 liefert die Per-Nutzer-Verwaltung; hier zunächst ein Handler genügt, Struktur so, dass der Umbau klein bleibt). Die Fabrik bekommt pro Request den `AuthContext` (SDK-Doku: `ctx.authInfo` bzw. `ctx.http.authInfo`; Zuordnung beim Bauen bestätigen).
  3. **Gate-Reihenfolge (fest):** (a) Origin: `originValidationResponse(request, allowedOrigins)` aus dem SDK (ignoriert Ports, fehlender `Origin` passiert; ungültig → 403) mit `getConfig().allowedOrigins` (enthält per Default die Origin von `BASE_URL`) plus `hostHeaderValidationResponse` mit Host aus `BASE_URL`; (b) Methode: nur POST, GET/DELETE → 405 (zustandslos); OPTIONS nur, wenn Browser-Clients es nachweislich brauchen; (c) Token → `authenticateMcpRequest` (Aufgabe 6), bei Fehlschlag Antwort aus `errors.ts`; (d) Zusatzprüfung (Teil von (c)); (e) `handler.fetch(request, { authInfo })`. Eine separate Origin-Middleware gibt es nicht (Eigenschaft von `/mcp`, nicht der Auth-Endpunkte).
  4. `dummy-upstream.ts` implementiert `ToolSource` mit Slug `dummy`: `echo` (text), `add` (Zahlen, Schema-Validierung), `whoami` (liefert `userId`, `role`, Token-Typ, Scopes aus dem Kontext), `slow_echo` (reagiert auf das `AbortSignal`, für Aufgabe 8), `toggle_tool` (blendet ein Dummy-Tool aus/ein und ruft `notifyToolsChanged(ctx.userId)`; Testhilfe für A9, später durch den Phase-1-Toggle ersetzt). Namen nach außen `dummy__echo` usw. (P0-1). Tool-Fehler als `isError: true`.
  5. `upstream-port.ts`: `ToolSource { listTools(ctx): Promise<ToolDef[]>; callTool(ctx, name, args, opts: { signal: AbortSignal }): Promise<CallToolResult> }`. Der Handler kennt nur dieses Interface; Phase 1 implementiert es mit der echten Registry und fasst das SDK-Server-Objekt nicht an. Keine weitere Abstraktion.
  6. `tools/list` ohne gültigen Token liefert nichts: 401 vor dem MCP-Handler. Unbekannte Methoden/Tools liefern JSON-RPC-Fehler, keine Stacktraces.
- **Prüfung:** Handler-Test mit `fetch`: ohne Token 401 + Header; falscher Origin 403; GET 405; mit PAT `tools/list` ok. Zweiter Test mit dem SDK-Client (`@modelcontextprotocol/client`, Streamable HTTP) gegen den Testserver.
- **DoD:** `initialize`, `tools/list`, `tools/call` laufen mit einem 2025-11-25-Client und einem 2026-07-28-Client (SDK-Client v2 verhandelt automatisch, Version im Test protokollieren). A7 (PAT auf `/mcp`) und A8 erfüllt. Früh mit echtem Claude Code und Cursor anbinden (Risiko R1), nicht erst am Ende.

### Aufgabe 8: `list_changed`-Push und Abbruch

- **Zweck:** A9 und A10; ersetzt "kein Push" aus der früheren Fassung (Review B9, B10).
- **Dateien:** `server/mcp/notify.ts`, `server/mcp/handler.ts`.
- **Schritte:**
  1. **Handler je Nutzer** (bestätigt 2026-11-04): `Map<userId, McpHandler>`; Handler wird beim ersten Request des Nutzers erzeugt und nach Leerlauf (z. B. 10 min ohne offene Stream) per `close()` entsorgt. `notifyToolsChanged(userId)` ruft `notify` genau dieses Handlers (nur dessen Streams). Variante B (ein Handler, `bus` filtert nach `userId`) nur, falls der Spike zeigt, dass `bus` das sauber erlaubt; Bus-/`notify`-API ist aus den Typdefinitionen bekannt, Details unverifiziert.
  2. `subscriptions/listen`: Stream wird nach dem Gate geöffnet (Token und Zusatzprüfung wie sonst). Weil dort danach nicht mehr pro Request geprüft wird, gibt es zwei Absicherungen: (a) Höchstlaufzeit des Streams = Access-Token-TTL (300 s; danach schließen, Client verbindet neu und durchläuft das Gate; Umsetzung im Wrapper, Annahme), (b) `closeUserStreams(userId)` beim Widerruf von Consent/Client/PAT und bei Sperre (der Sperr-Hook gehört zu Phase 1 `user-lifecycle.ts`; 0b stellt die Funktion bereit und ruft sie aus den eigenen Widerrufspfaden).
  3. `maxSubscriptions` je Handler begrenzen (Wert im Spike festlegen).
  4. **Abbruch über HTTP = Stream schließen:** Das `AbortSignal` der Anfrage (Client schließt den Antwort-Stream) wird bis in `ToolSource.callTool(..., { signal })` durchgereicht. `notifications/cancelled` gilt nur noch auf stdio (Phase 1) und für 2025er-Legacy-Clients, nicht als HTTP-Abbruchsemantik der 2026er-Spec.
- **Prüfung:** (a) SDK-Client v2 hält `subscriptions/listen`, `toggle_tool` löst `tools_list_changed` aus; zweiter Nutzer mit offenem Stream sieht nichts; (b) nach Widerruf bzw. Ablauf der Höchstlaufzeit ist der Stream zu; (c) `slow_echo` wird per Verbindungsabbruch abgebrochen, `ToolSource` sieht `signal.aborted`; (d) 2025er-Client: kein Push, nächster `tools/list` zeigt die Änderung.
- **DoD:** A9 und A10 erfüllt; Mandantentrennung getestet.

### Aufgabe 9: Automatisierte Tests (Flow, Policy, Endpoint)

- **Zweck:** A3 und Regressionsschutz. Details in Abschnitt 6.
- **Dateien:** `tests/integration/oauth/*.test.ts`, `tests/integration/mcp/*.test.ts`, `tests/integration/api/*.test.ts` (Formtests, Szenarien 15 und 16), `tests/unit/dcr-policy.test.ts`, `tests/helpers/oauth-client.ts`.
- **Schritte:** Helfer bauen, Tests schreiben (erst rot gegen fehlende Teile), in die CI-Matrix aus 0a einhängen (`pglite` und `postgres`). Rate-Limits in einem eigenen Testlauf einschalten (E16).
- **DoD:** Alle Tests grün auf PGlite und Postgres.

### Aufgabe 10: Manuelle Abnahme mit Claude Code und Cursor

- **Zweck:** A1 und A2 mit echten Clients. Vorgehen in 6.3. **Voraussetzung:** Die Frontend-Seiten `/login`, `/register`, `/consent`, `/settings/connections`, `/settings/tokens` stehen gegen die echten Routen (Frontend-Plan, Stand "nach 0b"); sonst verschiebt sich diese Aufgabe, A3 bleibt davon unberührt.
- **DoD:** Protokoll (Datum, Client-Version, Ergebnis, Auffälligkeiten) in `docs/manual-tests/phase-0b.md`; Abweichungen als Issues/Risiken notiert.

### Aufgabe 11: Aufräumen und Übergabe an Phase 1

- **Zweck:** Schnittstellen festschreiben, Doku.
- **Schritte:** Abschnitt 10 gegen den Code prüfen; README-Abschnitt "Client verbinden" (Claude-Code-Befehl, PAT-Variante: `claude mcp add --transport http mcpwarden <url> --header "Authorization: Bearer <pat>"`; laut Claude-Code-Doku nutzt ein gesetzter Authorization-Header kein OAuth); Spec-Differenzen als Änderungsvorschlag für `spec.md` v0.4 sammeln (nicht selbst ändern): SDK-Name v2, zustandslos/keine Session-ID, `list_changed` über `subscriptions/listen` (2025er ohne Push), HTTP-Abbruch = Stream schließen (P0-14), CIMD, P0-3 in 0b, Loopback-Warnung stammt aus der MCP-Spec, Admin-Scope separat abwählbar (Phase 2), Audit-Sichtbarkeit (Nutzer eigene, Admin zusätzlich Instanzereignisse).
- **DoD:** Plan-Abschnitte 2 und 3 mit realen Befunden aktualisiert; `shared/api-types.ts` deckt alle Routen aus 4.1 und das Frontend ist über die Endstände informiert (Abweichungen von 4.1 im selben Commit nachgezogen); keine TODOs ohne Eintrag in 7/8.

## 6. Teststrategie

Basis ist der Harness aus 0a (Ordner `tests/`): das gebaute Artefakt `.output/server/index.mjs` als Kindprozess auf freiem Port, `TEST_BACKEND=pglite|postgres`, `TEST_PG_ADMIN_URL`, frische DB je Lauf, Standard-Testwerte für `BASE_URL=http://localhost:<port>`, `BETTER_AUTH_SECRET`, `MASTER_KEY`. Kein zweiter Harness, kein `@nuxt/test-utils`. Rate-Limit per Test-Schalter (E16) aus, im eigenen Lauf an. Nutzer: erster Nutzer per Sign-up (wird Admin), weitere (Nutzer B, Nicht-Admin) über `createUser()` des Admin-Plugins, weil die Registrierung danach gesperrt ist.

### 6.1 Automatisiert: OAuth-Flow-Test (Vitest)

`tests/helpers/oauth-client.ts`: kleiner fetch-basierter Client, der Browser und MCP-Client simuliert: PKCE (S256), `state`, `resource`-Parameter, Cookie-Jar, kein Browser. Absichtlich nicht der SDK-Client für die Protokollschritte, damit jede HTTP-Stufe prüfbar bleibt.

Szenarien (jeweils eigener Test):

1. **Happy Path:** `POST /mcp` ohne Token → 401, Header enthält `resource_metadata`; Protected-Resource-Metadata → AS-Metadata → DCR → Login (Fixture) → `/oauth2/authorize` (mit `resource`) → Redirect auf Login/Consent → Consent → Redirect mit `code` und `iss` → Token-Request mit `code_verifier` und `resource` → `POST /mcp` `tools/list` enthält `dummy__echo` → `tools/call` echo → Ergebnis stimmt.
2. **PKCE-Pflicht:** Authorize ohne `code_challenge` bzw. mit `plain` → Fehler; falscher `code_verifier` → `invalid_grant`.
3. **Redirect-URI exakt:** abweichende URI → Fehler ohne Redirect.
4. **Code-Einmaligkeit:** zweiter Tausch desselben Codes scheitert.
5. **Refresh:** Tausch → neues Paar; altes Refresh-Token erneut → Ablehnung (Replay-Erkennung; `refreshTokenReuseInterval` von 30 s berücksichtigen).
6. **Audience:** Token mit anderem `aud` (zweite Resource registrieren oder manuell signieren) → 401; Request ohne `resource` → definiertes Verhalten laut Annahme 7.
7. **Sofortiger Widerruf** (jeweils mit noch gültigem JWT, ohne Warten): (a) Consent widerrufen → nächster `/mcp`-Request 401; (b) Client deaktiviert → 401; (c) Nutzer gesperrt → 401; (d) **nur Refresh-Token widerrufen (RFC 7009), Consent bleibt → 401**; (e) Refresh-Token nach Widerruf nicht mehr tauschbar; (f) PAT nach Widerruf bzw. Sperre → 401.
8. **Scopes:** Token ohne `mcp:tools` → 403 `insufficient_scope`.
9. **DCR-Policy:** `off` → Registrierung abgelehnt; `allowlist` → Claude-Code-ähnlicher Request (`name`, `redirect_uris: ["http://127.0.0.1:53124/callback"]`) ok, `http://evil.example/cb` abgelehnt, unbekannter Name mit Loopback-URI abgelehnt (Name **und** URI-Muster müssen passen); `open` → alles Zulässige ok, `allowlisted=false` in `oauth_client_meta`; Direktaufruf der Plugin-Route wird ebenfalls gefiltert; Rate-Limit schlägt nach Schwelle an.
10. **Consent-Daten:** `consent-info` meldet `allowlisted:false` für unbekannten Client, `true` für gelisteten; `loopback` bei Loopback-Redirect; `scopes` enthalten `mcp:tools` (`required:true`) und nie `mcpwarden:admin`; ungültige Signatur → 400 `invalid_consent_query`; ohne Session 401.
11. **Admin-Zugriff:** Admin-Routen unter `/api/admin/oauth/*`: anonym 401, Nutzer B (kein Admin) 403, Admin 200.
12. **Origin:** `Origin: https://evil.example` → 403; ohne `Origin` ok; Origin aus `ALLOWED_ORIGINS` ok.
13. **PAT:** erzeugen (Klartext nur in der POST-Antwort, Präfix `mcpw_pat_` + 4 Zeichen), Nutzung, `last_used_at` gesetzt, Widerruf → 401; Nutzer B kann PAT von A nicht sehen oder widerrufen (404).
14. **Isolation/Leak:** unauthentifizierte Requests (`tools/list`, `initialize`) liefern keinen Tool-Namen im Body.
15. **Formtests der Routen (Vertrag):** Für jede Route aus 4.1 prüft ein Test Schlüsselmenge und Wertetypen der Antwort (u. a. ISO-8601-Zeitstempel, `null` statt fehlender Felder, `expiresAt`-Regel, `limit.max` 20, Präfixlänge 13) und den Fehlerkörper (`data.code`). Kompilierzeit: `satisfies` gegen `shared/api-types.ts`. Canary: kein Secret-Feld in einer Antwort außer `PatCreated.token`.
16. **Clients des Nutzers:** `GET /api/me/connections` zeigt `lastUsedAt` nach einem `/mcp`-Aufruf (Toleranz 1 min wegen Drosselung) und `active:true`; ohne Aufruf `lastUsedAt:null`, `active:false`; Widerruf → 204, danach 401 auf `/mcp` und 404 beim zweiten Widerruf.

### 6.2 Automatisiert: Protokolltests mit SDK-Client

- `@modelcontextprotocol/client` (v2) mit Bearer-PAT gegen `/mcp`: `listTools`, `callTool` für `echo`, `add` (Argumentfehler → Fehlerergebnis), `whoami`. Protokollversion im Test auslesen und loggen. Zweiter Lauf erzwingt den Legacy-Pfad (2025-11-25 mit `initialize`), falls der Client eine Version erzwingen lässt (Option unverifiziert; sonst manuell).
- **Push (A9):** SDK-Client v2 mit offenem `subscriptions/listen` für Nutzer A, zweiter Client für Nutzer B; `toggle_tool` für A → nur A bekommt `tools_list_changed`. Prüfung der Stream-Schließung bei Widerruf und Höchstlaufzeit.
- **Abbruch (A10):** `callTool('slow_echo')` mit `signal`; `abort()` → `ToolSource` sieht `signal.aborted`. Für die Legacy-Ära (`notifications/cancelled`) gibt es in 0b nur den stdio-losen HTTP-Weg, also genügt der Verbindungsabbruch.
- Der SDK-Client mit OAuth-Provider-Interface als vollständiger Durchlauf ist wünschenswert, aber hinsichtlich der API **unverifiziert**; nur falls ohne großen Aufwand machbar.

### 6.3 Manuell: Abnahme mit Claude Code und Cursor

Vorbereitung: `BASE_URL=http://localhost:3000`, frische DB, Admin-Nutzer registriert, DCR-Modus `open`.

1. Claude Code (Version notieren, ≥ 2.1.231 wegen Callback-Fix laut Doku): `claude mcp add --transport http mcpwarden http://localhost:3000/mcp`.
2. In Claude Code `/mcp` → `mcpwarden` → authentifizieren. Erwartung: Browser öffnet `/login`, dann Consent. Warnung sichtbar, falls Claude Code nicht in der Allowlist matcht; sonst keine. Beides notieren.
3. Status "verbunden"; `/mcp` listet `dummy__echo`, `dummy__add`, `dummy__whoami`.
4. Prompt: "Rufe das echo-Tool mit 'hallo' auf" → Ergebnis; `whoami` zeigt Token-Typ `oauth`, Nutzer-ID und Rolle.
5. Widerruf: Seite "Clients" (`/settings/connections`) → Claude Code widerrufen; weiterer Tool-Aufruf → Fehler/Neu-Auth (erwartet 401 beim nächsten Request). Variante: Refresh-Token allein widerrufen (per API), gleicher Effekt.
6. Modus-Test: DCR-Modus `aus`, `claude mcp remove` und neu hinzufügen → saubere Fehlermeldung (Inhalt notieren; Fallback auf CIMD/Pre-Config scheitert ohne CIMD).
7. PAT-Variante: PAT erzeugen, `claude mcp add --transport http mcpwarden-pat http://localhost:3000/mcp --header "Authorization: Bearer <pat>"`; Tools sichtbar; PAT widerrufen → Fehler.
8. **Cursor (Pflichtclient, O1):** `mcp.json` `{"mcpServers": {"mcpwarden": {"url": "http://localhost:3000/mcp"}}}` (Format unverifiziert, gegen Cursor-Doku prüfen), OAuth durchlaufen, `echo` aufrufen. Redirect-Schema (`cursor://` oder Loopback) und Version notieren; Tool-Liste nach `toggle_tool` prüfen (Push je nach Protokollrevision des Clients). Fallback MCP Inspector (`npx @modelcontextprotocol/inspector`, Streamable HTTP mit OAuth, Funktionsumfang unverifiziert) nur bei nachgewiesenem Cursor-Problem.
9. Optional: Tunnel mit HTTPS, `BASE_URL` auf Tunnel-Host, Claude Desktop/Web als Custom Connector; Callback-URLs in die Allowlist übernehmen (sonst Phase 1.4).

Abnahmeprotokoll: Tabelle Client × Version × Protokollrevision × Ergebnis × Auffälligkeiten.

## 7. Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| R1: 2026-07-28-Spec/SDK v2 sind neu; Claude Code oder Cursor sprechen evtl. noch 2025-11-25 mit `initialize` und erwarten Session-Verhalten (GET-SSE, `Mcp-Session-Id`) | Verbindung scheitert oder kein Push für diese Clients | Stateless-Legacy-Pfad (Default) testen; echte Clients früh (Aufgabe 7) anschließen; bei Problemen sessionful Variante mit `isLegacyRequest`-Routing abschätzen |
| R2: JWT-Access-Tokens nicht serverseitig widerrufbar | "401 beim nächsten Request" verfehlt | Kurze TTL plus DB-Prüfung bei jedem Request inkl. Refresh-Token-Zustand (Aufgabe 6) |
| R3: DCR-Policy greift nur, wenn sich `/oauth2/register` abfangen lässt | Policy umgehbar | `clientPrivileges`/Hook (Spike), Nitro-Middleware als Fallback; Test des Direktaufrufs der Plugin-Route |
| R4: Allowlist-Abgleich über Namen ist fälschbar | "Allowlisted" trügt | Name **und** Redirect-Muster müssen matchen; Consent zeigt immer Redirect-Host; Allowlist ist Komfort/Warnlogik |
| R5: Loopback-Redirect-Impersonation | Phishing eines Codes | Redirect-Host immer anzeigen, Zusatzwarnung bei Loopback, PKCE Pflicht, kurze Code-Lebensdauer |
| R6: Claude Code Redirect-URI `127.0.0.1` vs `localhost` (Bug in v2.1.229 laut Doku) | Exakter Abgleich scheitert | Beide Loopback-Formen mit beliebigem Port in Allowlist; Version im Protokoll |
| R7: Token ohne `resource` bleibt opak oder ohne passendes `aud` | Audience-Bindung wirkt nicht für manche Clients | Annahme 7, Test 6.1-6, Default-Resource erzwingen oder ablehnen |
| R8: Hinter Reverse-Proxy falsche Issuer-/Resource-URLs | Clients lehnen Metadaten ab | URLs nur aus `BASE_URL`; Test mit `X-Forwarded-*`, die ignoriert werden |
| R9: PGlite Single-Connection und Zusatzabfrage pro Request | Latenz, Sperren | Kurze Einzelqueries, keine Transaktionen; Overhead messen (Ziel ≪ 50 ms) |
| R10: Plugin-Pfadänderungen (`@better-auth/*` v1.7.x jung) | Breaking Changes | Versionen exakt pinnen; Flow-Test als Schutz |
| R11: Langlebige `subscriptions/listen`-Streams umgehen die Prüfung pro Request | Widerrufener Nutzer bleibt verbunden | Höchstlaufzeit = Token-TTL, `closeUserStreams` bei Widerruf, `maxSubscriptions` (Aufgabe 8) |
| R12: Handler je Nutzer: Speicher/Anzahl bei vielen Nutzern | Ressourcenverbrauch | Leerlauf-Entsorgung, Single-Instance-Ziel (wenige Nutzer); Variante B (Bus-Filter) als Alternative |
| R13: CIMD wird Standard-Pfad der Clients (DCR "nur Fallback") | CIMD-only-Clients können sich nicht registrieren | Beobachten; `@better-auth/cimd` mit derselben Allowlist als Folgeaufgabe |
| R14: Consent-Weiterleitung hängt an Details des Better-Auth-Clientplugins; `/login` aus 0a muss die signierte Query erhalten | Aufwand im Frontend | Spike in Aufgabe 1/4, Beispiel der Doku befolgen |
| R15: Refresh-Token-Prüfung greift nicht bei Clients ohne `offline_access` | Einzel-Token-Widerruf dort nicht sofort | **Entschieden (Teil 1): `offline_access` ist Pflicht-Scope.** Consent bietet immer `openid offline_access mcp:tools` an und verlangt alle; der Guard verlangt bei jedem OAuth-Token einen lebenden Refresh-Token (Tests grün). Offen (Spike, wartet auf 0a): ob das Plugin `offline_access` beim Authorize ergänzen kann; sonst Clients ohne `offline_access` mit klarem Fehler ablehnen und dokumentieren. |
| R16: Schema-Migrationen aus parallelen Branches kollidieren im Journal | Migrationsfehler | Strikt sequentiell 0000 → 0001 → 0002 → Phase 1; `db:check` in CI |

## 8. Unverifiziertes (Sammlung)

Nicht gegen offizielle Quellen bestätigt: Status des alten `mcp`-Plugins in `better-auth/plugins`; Wirkung von `clientPrivileges` bei anonymer DCR und Existenz eines offenen `before`-Hooks für `/oauth2/register`; Rückgabe einer (gestreamten) Web-`Response` aus dem h3-1.15-Handler; ob `@better-auth/oauth-provider` automatisch mitkommt; Claims im JWT (`sid`, `azp`) und Verhalten ohne `resource`; Refresh-Token-Schema und Verhalten bei Clients ohne `offline_access`; Claude-Web-Callback-URLs; Cursor-`mcp.json`-Format und Redirect-Schema; MCP-Inspector-OAuth-Funktion; ob Claude Code/Cursor heute 2026-07-28 sprechen; SDK-`ctx.authInfo`-Zuordnung in der Fabrik; Details von `bus`/`notify`/`maxSubscriptions` und ob sich eine Höchstlaufzeit der Streams sauber setzen lässt; ob `subscriptions/listen` über POST läuft; Name des Rate-Limit-Test-Schalters (0a); Nitro-`scheduledTasks`-Reife; Claude-Code-Version mit Callback-Fix außer dem in der Doku genannten Stand (≥ 2.1.231).

## 9. Nicht in 0b

**Alle Vue-Dateien unter `app/**`** (Frontend; insbesondere Consent-Seite, DCR-Admin-Seite, Token- und Clients-Seiten, Layouts, Middleware), Dashboard-, Statistik- und Audit-Routen, Geräte-/Gerätenamen-Felder, ein wirksamer Admin-Scope (`mcpwarden:admin` kommt in Phase 2, samt separatem Abwählen beim Consent), echte Upstreams, Tool-Filter, Rate-Limits (außer DCR/Auth-Endpunkte von Better Auth), stdio, REST-Tools, Verwaltungs-Tools (`mcpwarden:admin`-Scope-Inhalt), **Audit-Log** (`audit_log`/`audit()` legt Phase 1 an; in 0b nur eine Logger-Zeile pro Request ohne Inhalte; Logger mit Redaction ebenfalls Phase 1), Einladungen/Allowlist für Nutzer, Nutzerliste, Löschen/Sperren-Oberfläche und `user-lifecycle.ts` (Phase 1, Meilenstein 1.1; 0b greift beim Sperren/Löschen nur über den Zugriffs-Check), CIMD, sessionful MCP, Profile (`/mcp/:profile`), Umstiegstest PGlite → Postgres (Phase 1).

## 10. Schnittstellen für Phase 1

**Auth-Kontext pro Request** (`server/auth/auth-context.ts`). Der Typ heißt einheitlich `AuthContext` (ersetzt `GatewayAuth` aus dem Phase-1-Plan; Feldname `tokenType`, nicht `kind`; `role` ist ergänzt, Review-Entscheidung). Er wird vom Gate erzeugt und an jeden Tool-Handler durchgereicht (im SDK als `authInfo.extra`, Zugriff über `getAuthContext(ctx)`); für Routen außerhalb des SDK-Handlers gibt es `authenticateMcpRequest(request): Promise<AuthContext | Response>` in `server/auth/access-guard.ts` (ersetzt `requireGatewayAuth`):

```ts
export type AuthContext = {
  userId: string;                  // user.id aus Better Auth (Text); Basis jeder Query (Mandantentrennung)
  role: 'admin' | 'user';          // aus der Nutzerzeile des Zugriffs-Checks
  tokenType: 'oauth' | 'pat';
  tokenId: string;                 // oauth: Token-/Consent-Referenz (jti oder Consent-ID), pat: PAT-ID
  clientId: string | null;         // oauth: OAuth-client_id, pat: null
  clientName: string | null;       // für Audit/Statistik (untrusted, gekürzt)
  scopes: string[];                // z. B. ['mcp:tools'], später 'mcpwarden:admin'
  expiresAt: number | null;        // Unix-Sekunden; PAT: null
  resource: string;                // BASE_URL + '/mcp' (später Profilpfad)
};
```

Verträge für Phase 1:

- Jede Datenbankabfrage nimmt `ctx.userId`; kein Handler liest eine Nutzer-ID aus Request-Parametern. `decryptSecret` bekommt die `userId` aus dem Kontext, nie aus der Zeile.
- Datenzugriff über `getDb()`, Auth über `getAuth()` (beide async), Session-Helfer `requireUser`/`requireAdmin`; Tabellen ohne Präfix; Einstellungen in `app_setting` (Schlüssel `oauth.dcr_mode` belegt von 0b).
- Scope-Prüfung läuft im Gate (403 `insufficient_scope`); Scope-Name `mcp:tools`; Phase 2 ergänzt `mcpwarden:admin` in `scopes` und `scopes_supported`.
- **`ToolSource`** (`server/mcp/upstream-port.ts`) ist der Austauschpunkt für die echte Upstream-Registry (Namen `<upstream>__<tool>`): `listTools(ctx)` und `callTool(ctx, name, args, { signal })`. Phase 1 implementiert das Interface und baut kein eigenes `createGatewayServer`; der MCP-Handler bleibt in `server/mcp/handler.ts`.
- **Push:** `notifyToolsChanged(userId)` und `closeUserStreams(userId)` aus `server/mcp/notify.ts`. Phase 1 ruft `notifyToolsChanged` beim Deaktivieren/Toggle von Tools und Upstreams, `closeUserStreams` aus `user-lifecycle.ts` beim Sperren/Löschen. 2025er-Clients erhalten keinen Push (akzeptiert).
- **Abbruch:** Über HTTP ist das Schließen des Antwort-Streams der Abbruch; das `AbortSignal` in `callTool` ist maßgeblich. Phase 1 testet je Ära (HTTP-2026 → Fake-Upstream sieht Verbindungsabbruch; Legacy/stdio → `notifications/cancelled`).
- Gate-Reihenfolge fest: Origin → Methode → Token → Zusatzprüfung → MCP-Handler. Der Origin-Check liegt in 0b; die Phase-1-Aufgabe 1.2.1 entfällt. Phase 1 hängt Rate-Limit pro Token (`tokenId`) und Statistik (`clientId`, `tokenId`) zwischen Zusatzprüfung und Handler.
- Sperren eines Nutzers wirkt über den Zusatzcheck sofort für OAuth-Tokens und PATs; Phase 1 baut die Admin-Oberfläche und `user-lifecycle.ts` (Einladungen, Nutzerliste, Sperren, Löschen) auf `user.banned`/`admin()` aus 0a.
- Zustandslosigkeit: Es gibt keine Gateway-Session; gepoolte Upstream-Client-Sessions (Phase 1) hängen an `(userId, upstreamId)`, nicht an einer MCP-Session-ID.
- Audit: `audit_log` und `audit()` legt Phase 1 an; 0b hat nur die Logger-Zeile pro Request. Randbedingung für die Lese-Route in Phase 1 (bestätigt 2026-11-04): Nutzer sehen nur eigene Einträge, Admins zusätzlich Instanzereignisse (Nutzer gesperrt, Einstellung geändert).
- Frontend-Vertrag: Die Routen und Typen aus 4.1 sind Teil der Schnittstelle. Phase 1 nutzt dieselbe Fehlerform (E19) und ergänzt `shared/api-types.ts`, ohne bestehende 0b-Felder umzubenennen oder zu entfernen. `ConnectionSummary.active` (Statuswort "Aktiv") und `lastUsedAt` bleiben die Quelle für die Clients-Tabelle des Dashboards.
- Offen für Phase 1: Das Dashboard-Leerzustand-Frontend braucht die MCP-URL (`BASE_URL + '/mcp'`); `ConsentInfo.resource` liefert sie nur im Consent-Fall. Vorschlag: Feld `mcpUrl` in `GET /api/me/capabilities` (Phase 1).
- Migrationen: 0001 und 0002 stammen aus 0b, Phase 1 beginnt bei 0003.

## 11. Befunde Teil 1 (Umsetzung ohne 0a, 2026-11-04, Node 24.13, `@modelcontextprotocol/server`/`client` 2.4.0)

Belegt durch `tests/unit/mcp-gateway.test.ts` (echter HTTP-Server, SDK-Client v2):

- `createMcpHandler(factory, { legacy: 'stateless' })` bedient 2025-11-25 (Client `mode: 'legacy'`, `initialize`, ohne Session-ID) und 2026-07-28 (`mode: 'auto'`) am selben Endpoint. GET/DELETE beantwortet das Gate mit 405.
- `authInfo` kommt in der Fabrik als `mctx.authInfo` an (Wert aus `handler.fetch(request, { authInfo })`); der `AuthContext` reist in `authInfo.extra`. Der Abbruch erreicht `ctx.mcpReq.signal`, wenn die Web-`Request` ein `signal` trägt (Schließen des Antwort-Streams); A10 auf dieser Ebene belegt.
- `handler.notify.toolsChanged()` erreicht nur Listen-Streams des eigenen Handlers; mit einem Handler je Nutzer ist Mandantentrennung belegt (A9). 2025er-Client erhält keinen Push. `client.listen()` läuft nur auf 2026-Verbindungen.
- Höchstlaufzeit der Listen-Streams wird im Wrapper (`limitStream`) durchgesetzt; `closeUserStreams` = `handler.close()` plus Verwerfen des Handlers. Der Body muss vor `handler.fetch` ausgewertet werden (danach verbraucht).
- Origin-/Host-Helfer des SDK vergleichen nur Hostnamen (port-agnostisch); fehlender `Origin` passiert, `null`/Unparsbares wird 403.
- Offen, wartet auf 0a: gestreamte Web-`Response` aus dem h3-Handler im gebauten Nitro, Bindung an `requireMcpAuth`/`verifyAccessTokenRequest`, alle Spike-Fragen aus Aufgabe 1.
