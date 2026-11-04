# Review der Umsetzungspläne 0a, 0b, 1

Stand: 2026-11-04 · Grundlage: `docs/spec.md` v0.3, `docs/plans/phase-0a.md`, `phase-0b.md`, `phase-1.md`
Spec und Pläne wurden nicht geändert. „Geprüft“ heißt: gegen npm-Registry, offizielle Doku, Paket-Typdefinitionen oder per Spike nachvollzogen. „Unverifiziert“ ist markiert.

## Kurzfazit

Die drei Pläne sind einzeln brauchbar, passen aber an den Nahtstellen nicht zusammen: fast jede „Erwartung an 0a“ aus 0b und Phase 1 nennt andere Pfade, Exporte und Helfer, als 0a liefert. Dazu kommen zwei Lücken, die keiner der Pläne abdeckt: Admin-Funktionen aus P0-4 (erster Nutzer = Admin, Einladung/Allowlist, Nutzer sperren/löschen) und der Umstiegstest PGlite→Postgres (P0-11). Der PGlite-Spike ist erledigt und grün (siehe S1), 0a hängt also nicht mehr an U2. Ein Startproblem in 0a ist blockierend: Nitro wartet asynchrone Plugins nicht ab (B1).
**Freigabe:** 0a **ja nach Korrektur von B1, B2, B3** · 0b **nein**, erst nach Schnittstellenabgleich (Abschnitt „Schnittstellen“) · Phase 1 **nein**, erst nach B2, B4, B5, B6 und Schnittstellenabgleich.

## Geprüfte Fakten (Belege für die Befunde)

| ID | Geprüft | Ergebnis |
|---|---|---|
| S1 | Spike im Scratchpad: `better-auth` 1.7.17 + `@better-auth/drizzle-adapter` 1.7.17 (`provider: 'pg'`) + `drizzle-orm` 0.45.4 + `@electric-sql/pglite` 0.5.15, Node 24.13 | Sign-up 200, Sign-in 200, 30 parallele `getSession` ok, `migrate()` zweimal → 1 Eintrag in `drizzle.__drizzle_migrations`, Neustart mit gleichem `dataDir` ok. U2 (0a) ist damit erledigt. Nicht geprüft: Lauf innerhalb Nuxt/Nitro. |
| S2 | `npx auth@1.7.17 generate --help` | `--dialect postgresql` (wird für Drizzle auf `pg` abgebildet). U1 (0a) erledigt. Generiertes Schema: `id text`, Spalten explizit snake_case (`email_verified`, `user_id`). |
| S3 | Schema-Generierung mit `admin()`, `jwt()`, `mcp()` | Tabellen: user, session, account, verification, jwks, oauth_client, **oauth_resource**, **oauth_client_resource**, oauth_refresh_token, oauth_access_token, oauth_consent, oauth_client_assertion. `admin()` ergänzt `role`, `banned`, `ban_reason`, `ban_expires`. CLI-Config mit `mcp()` braucht `baseURL`, sonst Abbruch („Invalid URL“); `mcp()` versucht beim Start `resources` in die DB zu schreiben. |
| S4 | `nitropack@2.13.6` `runtime/internal/app.mjs` | `runNitroPlugins` ruft `plugin(nitroApp)` ohne `await`. Async-Plugins laufen also nebenläufig zum ersten Request. U4 (0a) ist **widerlegt**. |
| S5 | `@nuxt/nitro-server@4.6.4` | h3 `^1.15.11`, nitropack `^2.13.6`. `toWebRequest(event)` ist der richtige Weg (0b Punkt 8 erledigt). |
| S6 | `@nuxt/test-utils` 4.3.4 Peers | `vitest ^4.0.2 \|\| ^5.0.0`: Kompatibilität laut Peer gegeben (0a-Begründung „unverifiziert“ trifft nicht mehr zu). |
| S7 | `@modelcontextprotocol/client` 2.4.0 Typen | `StreamableHTTPClientTransport` und `SSEClientTransport` haben `fetch?: FetchLike`; `RequestOptions` hat `signal`, `timeout`, `maxTotalTimeout`. Phase-1-Risiko R6 und „unverifiziert: timeout/signal“ sind damit entschärft. |
| S8 | `@modelcontextprotocol/server` 2.4.0 Typen | `createMcpHandler` Optionen `legacy: 'stateless' \| 'reject'` (Default stateless), `bus`, `maxSubscriptions`, `keepAliveMs`; Rückgabe `{ fetch, close, notify, bus }`. `subscriptions/listen` wird unterstützt, `notify` publiziert `tools_list_changed` an **alle** offenen Listen-Streams des Handlers. Low-Level-Klasse `Server` ist exportiert, ebenso `originValidationResponse`, `hostHeaderValidationResponse`, `isLegacyRequest`. |
| S9 | MCP-Spec 2026-07-28 (Transports, Streamable HTTP) | Keine Sessions, kein GET-Stream; `list_changed` über `subscriptions/listen`; Sampling/Elicitation über MRTR (`InputRequiredResult`), Server senden keine Requests mehr; Abbruch auf Streamable HTTP = Schließen des Antwort-Streams, `notifications/cancelled` nur noch auf stdio; Origin vorhanden und ungültig → MUST 403. |
| S10 | Better-Auth-Doku `mcp`, `oauth-provider` | `mcp()` ersetzt `oauthProvider()`, `jwt()` Pflicht; JWT-Access-Tokens serverseitig nicht widerrufbar, deaktivierter Client: bestehende JWTs bleiben bis Ablauf gültig; Refresh-Rotation mit Reuse-Erkennung (`refreshTokenReuseInterval` bei `mcp()` 30 s); Rate-Limits `/oauth2/register` 5/60 s, `/oauth2/token` 20/60 s, nur bei aktivem globalem Rate-Limit (Standard: nur Produktion). Doku-Beispiel nutzt `legacy: "reject"`. Für DCR gibt es `clientPrivileges` (kann `create` verweigern); ob das für anonyme DCR greift, ist unverifiziert. |
| S11 | `@electric-sql/pglite-tools` 0.4.15 `pgDump({ pg })` auf Spike-DB | SQL-Dump mit Daten (`user`) und `drizzle`-Schema erzeugt. Import in Postgres nicht getestet. O3 (0a) ist technisch machbar. |
| S12 | libuv `src/unix/process.c` (v1.x) | Bei gesetztem `uid`/`gid` ruft libuv `setgroups(0, NULL)` vor `setgid`/`setuid`. Zusatzgruppen werden geleert, wenn `CAP_SETGID` vorhanden ist. Phase-1-R4 weitgehend erledigt; Pflichttest `id -G` bleibt sinnvoll. |
| S13 | npm-Versionen | Alle in den Plänen genannten Versionen stimmen (nuxt 4.6.4, better-auth 1.7.17, drizzle-orm 0.45.4, drizzle-kit 0.31.11, pglite 0.5.15, SDK v1 1.32.2 / v2 2.4.0, `@modelcontextprotocol/node` 2.1.2, vitest 5.1.0, typescript 7.0.2, zod 4.6.7, undici 8.12.3). |

## Befunde

| ID | Plan / Abschnitt | Schwere | Befund | Korrektur |
|---|---|---|---|---|
| B1 | 0a Task 7, U3/U4; Phase 1 §3 Plugins | blockierend | Nitro wartet async Plugins nicht ab (S4). `00-init.ts` mit `await getDb(); await runMigrations()` lässt Requests vor Ende der Migration zu; Phase-1-Plugin `20.gateway` startet vor der Migration. | Init als memoisiertes Promise in `getDb()` (Migration läuft darin genau einmal), `getAuth()` wartet darauf. Alle DB-Konsumenten sind damit automatisch abgesichert. Plugin startet nur `getDb().catch(exit(1))`. `/readyz` bleibt. U4 im Plan als widerlegt führen. |
| B2 | 0a O1/§8, 0b E8/E10/E11/E13, Phase 1 §3 | blockierend | P0-4 hat keinen Eigentümer: „erster Nutzer = Admin“, Rolle, `banned`, `requireAdmin`, Einladung/Allowlist, Admin-Seite (Nutzer auflisten, sperren, löschen), `onUserDisabled/Deleted`. 0a schiebt nach Phase 1, Phase 1 setzt es bei 0a/0b voraus, 0b braucht es schon für die DCR-Admin-Seite und den Sperr-Check. | 0a: `admin()`-Plugin in Migration 0000 (S3), Hook „erster Nutzer bekommt `role=admin`“, `requireAdmin`. Phase 1: neue Aufgabe in 1.1 „Einladungen/Allowlist, Nutzerliste, Sperren (Sessions, OAuth-Refresh-Tokens, PATs), Löschen“ inkl. `user-lifecycle.ts`. |
| B3 | 0a O1, Task 8 | wichtig | Registrierungssperre per `count(*)` im `before`-Hook ist ein Race: zwei parallele Erst-Registrierungen kommen beide durch (zwei Admins). Außerdem kann nach der Sperre kein Test einen zweiten Nutzer anlegen, 0b/Phase 1 brauchen aber Nutzer B für Isolationstests. | Sign-up in einem prozessweiten Mutex serialisieren (Single-Instance reicht). Zweite Nutzer in Tests über `auth.api.createUser` des Admin-Plugins anlegen; Helfer `createUser()` in 0a-Harness. |
| B4 | Phase 1 §1/§7, Spec P0-11 | blockierend (Abdeckung) | Umstiegstest Dump PGlite → Import Postgres → Start mit neuer `DATABASE_URL` steht in keinem Plan (0a O3 verweist auf Phase 1, Phase 1 hat ihn nicht). | Aufgabe in Phase 1 (z. B. 1.4.3): `pgDump` (S11) → `psql` in Postgres-Container → App mit `DATABASE_URL` → Login und Upstreams vorhanden. CI-Job. README-Abschnitt Backup/Umstieg. |
| B5 | Phase 1 §4.1, 1.3.1, 1.3.2 | blockierend (Sicherheit) | `ensureWorker({userId, uid})` kommt von der Web-App. Der Plan prüft nicht, dass der Supervisor die UID validiert. Eine kompromittierte Web-App könnte `uid: 0` oder die eigene UID anfordern; ein Kind mit UID 0 behält die permitted Capabilities (SETUID) und kann jede UID annehmen. | Supervisor akzeptiert nur `uid` im festen Bereich (≥ 20000, ≠ Web-UID, ≠ 0), `gid = uid`, `cwd` nur unter dem eigenen stdio-Baum. Test mit gefälschtem Befehl. |
| B6 | Phase 1 1.3.1 | blockierend (Sicherheit) | `DATA_DIR` wird an die Web-UID gechownt, `DATA_DIR/stdio` liegt darin. Die Web-App kann `stdio` umbenennen und durch Symlinks ersetzen; der Supervisor (root, `CAP_CHOWN`) chownt dann beliebige Pfade an eine Nutzer-UID. | Getrennte Bäume: `DATA_DIR` root-eigen 0755, `DATA_DIR/app` (pgdata) Web-UID, `DATA_DIR/stdio` root 0711. Nutzerverzeichnisse mit `mkdir` (exklusiv) + `lchown`/`O_NOFOLLOW`-Prüfung anlegen. Abweichung von Spec-Pfad `DATA_DIR/stdio/<user_id>` (Plan nutzt `<uid>`) in Spec übernehmen. |
| B7 | Phase 1 1.1.4 | wichtig (Sicherheit) | Prüfung über undici `connect.lookup` greift bei IP-Literalen nicht (kein DNS-Lookup). Die Testmatrix enthält Literale, die Umsetzung deckt sie nicht ab. | `assertPublicAddress()` zusätzlich auf literale Hosts vor dem Connect (nach WHATWG-URL-Normalisierung, die Dezimal/Hex/Oktal auflöst). Blockliste um `192.0.2/24`, `198.51.100/24`, `203.0.113/24`, `2001:db8::/32`, `2002::/16` (6to4, eingebettete v4 prüfen) ergänzen. SDK-Transporte bekommen eigene `fetch` (S7); `redirect: 'error'` für MCP-Transporte statt manuellem Folgen. |
| B8 | Phase 1 §4.1 | wichtig (Sicherheit) | Der Root-Supervisor parst alle MCP-Frames zwischen Web-App und Worker. Damit liegt jeder Byte aus fremden stdio-Kindern im Datenpfad des privilegierten Prozesses. | Supervisor reicht pro Worker eine angenommene Socket-Verbindung der Web-App als `stdio[3]` an den Worker durch (`spawn`-Option `stdio` akzeptiert Socket-Streams, FD wird dupliziert; Node-Doku, nicht live geprüft). Danach fließen Daten direkt Web-App ↔ Worker. Falls verworfen: Framegröße hart begrenzen. |
| B9 | 0b Annahme 2, R11; Phase 1 E2, R2 | wichtig | „Ohne Session kein `list_changed`-Push“ stimmt nur für 2025er-Clients. 2026-07-28-Clients nutzen `subscriptions/listen`, `createMcpHandler` bringt Bus und `notify` mit (S8, S9). | Phase 1: `tools_list_changed` beim Deaktivieren/Toggle publizieren. Achtung Mandantentrennung: `notify` geht an alle Streams des Handlers. Entweder Handler je Nutzer oder Bus, der nach `userId` filtert. 2025er-Clients: kein Push, akzeptieren. |
| B10 | Phase 1 §6, 1.2.6; Spec P0-14 | wichtig | Abbruch per `notifications/cancelled` gilt bei 2026-Upstreams über HTTP nicht mehr; dort ist Stream-Schließen der Abbruch (S9). Der Testplan erwartet `cancelled` beim Fake. | Test je Ära: HTTP-2026 → Fake sieht Verbindungsabbruch; Legacy/stdio → `notifications/cancelled`. Spec-Text P0-14 anpassen. |
| B11 | 0b Aufgabe 6, A5 | wichtig | Zusatzprüfung pro Request deckt Nutzer gesperrt, Client deaktiviert, Consent gelöscht ab. Ein einzelner Token-Widerruf (RFC 7009 auf Refresh-Token, Consent bleibt) wirkt erst nach Ablauf des JWT. Spec-Randfall „Token/Session widerrufen → 401 beim nächsten Request“ ist damit für diesen Fall nicht erfüllt. | Entweder zusätzlich prüfen, ob für `(user, client)` noch ein gültiger Refresh-Token existiert, oder Abweichung (≤ TTL 5 min) in Spec dokumentieren. Empfehlung: Prüfung ergänzen, eine Query mehr. |
| B12 | 0b Aufgabe 1 Schritt 4 | klein | Tabellenliste unvollständig: `oauth_resource`, `oauth_client_resource` fehlen (S3). `mcp()` schreibt beim Start Resources in die DB; mit 0a-`auth.cli.ts` (`{} as never` als DB) gibt es eine Fehlermeldung beim Generieren, die Generierung klappt mit gesetzter `baseURL`. | Liste korrigieren; `auth.cli.ts` setzt `baseURL`. |
| B13 | 0b Aufgabe 2 | klein | Protected-Resource-Metadata liefert `mcp()` selbst (S10), aber nur unter dem Auth-Handler. Eigenbau parallel dazu driftet. | Root-Routen `/.well-known/*` an `auth.handler` bzw. die Plugin-Helfer durchreichen statt JSON selbst zu bauen. |
| B14 | 0b Aufgabe 4 Schritt 2 | klein | DCR-Gate: vor der Nitro-Middleware `clientPrivileges` (kann `create` verweigern) prüfen; Wirkung bei anonymer DCR unverifiziert. | Im Spike von Aufgabe 1 testen; Middleware nur als Fallback. |
| B15 | 0b Aufgabe 3 Schritt 3 | klein | „Spec verlangt Hostname-Anzeige und Zusatzwarnung bei localhost“: steht nicht in `spec.md` (stammt aus der MCP-Spec). | Quelle richtig benennen; Anforderung behalten. |
| B16 | 0a Task 10, 0b 6.1 | wichtig | Tests laufen gegen das Build (`NODE_ENV=production`), dort ist das Better-Auth-Rate-Limit aktiv (Standard: nur Produktion). Mehrere Sign-ins je Test laufen in 429. 0b will Rate-Limits je Testlauf an/aus. 0a verbietet neue ENV-Variablen ohne Spec-Änderung. | Eine Test-ENV (z. B. `RATE_LIMIT=off`) in die ENV-Liste aufnehmen (siehe E7) oder Limits per Testkonfig über Admin-Einstellung schalten. |
| B17 | Phase 1 §1 A12, 1.2.7 | klein | Abnahmekriterium Overhead p95 hängt am eigenen Stats-Schreibpfad; ein Fehler dort verfälscht den Beleg. | Overhead zusätzlich im Lastskript außen messen (Client-Zeit minus Fake-Upstream-Zeit). |
| B18 | Spec „Phasen“ | wichtig | P0-14 und P0-15 sind keiner Phase zugeordnet; Phase 1 nimmt Teile (E3), den Rest „Phase 2“, Spec-Phase 2 kennt sie nicht. P0-3 (PAT) gehört laut Spec zu Phase 1, 0b zieht es vor (sinnvoll). | Spec-Phasen ergänzen: P0-14/P0-15-Minimum in Phase 1, Rest in Phase 2; P0-3 in 0b. |
| B19 | Spec Rahmen, P0-1, P0-5, P0-10, P0-12, P1 | wichtig | Spec-Texte veraltet bzw. durch begründete Planentscheidungen überholt: SDK-Paketname (v2), „Session-ID im Header“, Entschlüsselung „vom Supervisor“, ENV-Liste, „URL-Elicitation (2025-11-25)“ und `sampling/createMessage` (2026: MRTR, S9). | Spec v0.4: Abschnitt Änderungen mit den Punkten aus E1, E2, E4, E7 und dem MRTR-Hinweis für Phase 2/3. |
| B20 | 0a §2 TS 7 | klein | TypeScript 7.0.2 mit `vue-tsc`/`nuxi typecheck`: `vue-tsc` 3.3.14 verlangt nur `>=5.0.0`, Funktion mit TS 7 unverifiziert. | Default TS 5.9/6.x pinnen, TS 7 später als eigene Aufgabe. Spart einen Fehlstart in Task 1. |
| B21 | Phase 1 1.3.4, R4 | klein | Gruppen-Falle ist laut libuv-Quelltext gelöst (S12); `setpriv`-Fallback wird voraussichtlich nicht gebraucht. | Test behalten, `util-linux` nicht vorsorglich ins Image. |
| B22 | Phase 1 1.1.2 | klein | `gen_random_uuid()` ist seit Postgres 13 Kernfunktion, PGlite basiert auf Postgres 17. Risiko gering; im Migrationstest ohnehin abgedeckt. | „Unverifiziert“-Vermerk durch Test in 1.1.2 ersetzen. |
| B23 | alle | wichtig | Migrationen aus parallelen Branches kollidieren im drizzle-kit-Journal (`meta/_journal.json`). | Schemaänderungen strikt sequentiell (0a → 0b → 1), CI-Schritt `db:check` (0a Task 6) verpflichtend. |

## Schnittstellen-Abgleich (Erwartung vs. 0a/0b)

Typ `user.id` ist überall `text` (0a §8, 0b E8, Phase 1 A5; generiertes Schema bestätigt, S2). Alle anderen Punkte weichen ab.

| Thema | 0a liefert (§3, §8) | 0b erwartet (§3) | Phase 1 erwartet (§3) | Entscheidung |
|---|---|---|---|---|
| Konfiguration | `getConfig()` aus `process.env`, `server/utils/config.ts` | E1 `runtimeConfig` in `nuxt.config.ts` | `getConfig()` ✓ | 0a-Variante; 0b E1 streichen. |
| DB-Client | `getDb(): Promise<Db>` in `server/db/index.ts` | E2 `export db` in `server/db/index.ts` | `export const db` in `server/db/client.ts`, `casing: snake_case`, `withTx` | `getDb()` (wegen B1 async nötig). Kein `casing`-Flag: generiertes Schema benennt Spalten explizit (S2), eigene Tabellen ebenso. `withTx` streichen (YAGNI, PGlite: keine langen Tx). |
| Auth-Instanz | `getAuth(): Promise<Auth>` in `server/auth/index.ts`, Optionen in `options.ts` | E4 `export auth`; E6 Plugin-Array, `basePath` bekannt | – | `getAuth()`; 0b ergänzt Plugins in `options.ts` (0a §8). |
| Migration/Skripte | `db:schema`, `db:generate`, `db:check`; `server/plugins/00-init.ts` | E7 `db:generate-auth`, `db:migrate`, `server/plugins/migrate.ts` | `server/plugins/00.migrate.ts`, eigenes Plugin `20.gateway.ts` | 0a-Namen; Phase 1 `server/plugins/20-gateway.ts`, wartet auf `getDb()` (B1). |
| Migrationsnummern | `0000_init` | „0001“ für OAuth (+ `mcpw`-Tabellen) | `00NN_phase1_*` | Reihenfolge 0000 (0a inkl. `admin()`), 0001 (0b OAuth), 0002 (0b eigene), ab 0003 Phase 1; Namen vergibt drizzle-kit. |
| Rolle/Sperre | keine (O1 verschiebt Admin-Plugin auf Phase 1) | E8 `role`, E11 `banned`, erster Nutzer Admin | `role`, `banned` | in 0a über `admin()` (B2). |
| Session-Helfer | `requireUser(event) → { user, session }` | E10 `requireUserSession`, `getSessionOrNull`, `requireAdmin` | `requireUserSession → { userId, role }`, `requireAdmin` | ein Name: `requireUser` + `requireAdmin` in `server/utils/session.ts` (0a). |
| Seiten | `/login`, `/register` | E9 `/sign-in`, `loginPage: "/sign-in"` | – | `/login`; 0b `loginPage: "/login"`. |
| UI-Basis | button, input, label, card | E13 Admin-Layout, Table, Dialog, Alert, Badge, Select | Layout mit Nav, `/admin`-Guard | 0b ergänzt Komponenten und Admin-Layout. |
| Einstellungen | – | E14 `mcpw_app_setting` | `instance_setting` | **eine** Tabelle (0b legt sie an, Phase 1 nutzt sie). |
| Tabellen-Präfix | – | `mcpw_` | ohne Präfix | einheitlich ohne Präfix (Better-Auth-Tabellen haben auch keins). |
| Schlüsselableitung | `deriveUserKey` „später in `master-key.ts`“ | E15 `server/utils/crypto.ts` | `server/gateway/crypto/secrets.ts` | eine Datei: `server/gateway/crypto/secrets.ts`; 0a §8 anpassen. `decryptSecret` nimmt `userId` aus dem Auth-Kontext, nie aus der Zeile. |
| Auth-Kontext `/mcp` | – | `AuthContext` in `server/auth/auth-context.ts` (`tokenType`, ohne `role`) | `GatewayAuth` in `server/utils/gateway-auth.ts` (`kind`, `role`), `requireGatewayAuth(request)` | 0b-Typ und -Pfad; Feld `role` ergänzen (access-guard liest die Nutzerzeile ohnehin). |
| Naht zum Gateway | – | `ToolSource { listTools(ctx), callTool(ctx, name, args) }` in `server/mcp/upstream-port.ts` | `createGatewayServer(auth)` in `server/gateway/index.ts` liefert MCP-Server | `ToolSource` behalten, `callTool(ctx, name, args, { signal })` ergänzen. Phase 1 implementiert `ToolSource`, fasst das SDK-Server-Objekt nicht an. `list_changed` (B9) über den Handler aus 0b. |
| Scope | – | `mcp:tools` | „`mcp`“ | `mcp:tools`. |
| Origin-Prüfung | – | A8, `server/middleware/origin-check.ts` | 1.2.1 nur „falls nicht in 0b“ | in 0b; Phase-1-Aufgabe 1.2.1 streichen. |
| Audit | – | ausdrücklich nicht in 0b (§9) | E9 „0b legt `audit_log` an“ | Phase 1 1.1 legt `audit_log` + `audit()` an. |
| Logger | – | – | `server/utils/logger.ts` mit Redaction | Phase 1 legt an (in 1.1). |
| Lebenszyklus | – | – | `user-lifecycle.ts` aus 0a/0b | Phase 1 (B2). |
| Health | `/healthz`, `/readyz` in 0a | E17 unverändert | in §5 als neue Dateien | Phase 1 ändert die 0a-Dateien (Supervisor-Check). |
| Tests | `tests/`, Build als Kindprozess, `TEST_BACKEND`, `TEST_PG_ADMIN_URL` | E12 `test/helpers/`, `@nuxt/test-utils` | `test/helpers/db.ts` `createTestDb()`, `TEST_DATABASE_URL`, `@nuxt/test-utils` | 0a-Harness und -Variablen für alle; Ordner `tests/`. `@nuxt/test-utils` wäre laut Peer möglich (S6), aber zwei Harnesses sind einer zu viel. |
| ENV | sechs Spec-Namen, „neue nur mit Spec-Änderung“ | `ALLOWED_ORIGINS` | + `STDIO_MODE`, `SUPERVISOR_SOCKET`, `WEB_UID/GID`, `TRUST_PROXY` | siehe E7. |

## Empfehlungen zu den Entscheidungen

### Kann ich allein empfehlen

| Punkt | Empfehlung | Begründung |
|---|---|---|
| Phase 1 E1 SDK v2 | v2 (`@modelcontextprotocol/server`/`client` 2.4.0, `node` 2.1.2) | stabile Linie, Better-Auth-Doku baut darauf, nötige Optionen vorhanden (S7, S8). |
| E3 Umfang P0-14/15 | wie vorgeschlagen | Timeouts/Breaker/Messpfad sitzen im Aufrufpfad; Spec-Phasen nachziehen (B18). |
| E4 Entschlüsselung in der Web-App | annehmen | Supervisor bleibt ohne Key und DB; das Schutzziel „Worker-Env sauber“ bleibt. Die Web-App hält den Key ohnehin. Spec-Text P0-5 ändern. |
| E5 ein Container, Supervisor startet Web-App | annehmen, mit B5, B6, B8 | Root→Nicht-Root-`setuid` leert permitted/effective; `no_new_privs` verhindert Rückgewinn. |
| E6 slim/full | annehmen; in `slim` ist stdio fest aus (kein Supervisor-Bundle), nicht nur Default | sonst ist „slim = nur HTTP/REST“ (Spec) nur eine Voreinstellung. |
| E7 zusätzliche ENV | nur `STDIO_MODE` und `TRUST_PROXY` (+ ein Test-Schalter, B16); Socket-Pfad und Web-UID als Konstanten | YAGNI; feste Werte im Image. Spec P0-10 um die Liste ergänzen. |
| E8 neue Tools standardmäßig an | ja | Spec P0-7 schweigt; Rug-Pull-Schutz kommt mit P1-Poisoning-Prüfung. |
| E9 `audit_log` | Phase 1 legt an | 0b schließt Audit aus. |
| 0a O2 OAuth-Tabellen erst in 0b | ja | Generierung mit `mcp()` funktioniert nachträglich (S3); Migration 0001. |
| 0a O3 Umstiegstest nicht in 0a | ja, aber Phase 1 muss ihn tragen (B4) | `pgDump` funktioniert (S11). |
| 0b O2 TTL 5 min / Refresh 30 d | ja | mit Zusatzprüfung pro Request (und B11) ist die TTL zweitrangig. |
| 0b O3 Scopes `openid offline_access mcp:tools`, `mcpwarden:admin` reserviert | ja | Phase 1 auf `mcp:tools` angleichen. |
| 0b O4 DCR-Rate-Limit 5/min | ja | wirkt nur mit aktivem Rate-Limit und korrekter Client-IP hinter dem Proxy (0a R9). |
| 0b Annahme 4 DCR ohne CIMD | ja für 0b | in A1/A2 beobachten, ob Claude Code oder Cursor CIMD bevorzugen; `@better-auth/cimd` 1.7.17 existiert als Folgeaufgabe. |
| 0b `legacy: 'stateless'` | ja (nicht `reject` wie im Doku-Beispiel) | 2025er-Clients müssen bedient werden; mit echtem Claude Code in Aufgabe 5 bestätigen. |

### Muss der Nutzer entscheiden

| Punkt | Frage | Empfehlung |
|---|---|---|
| Phase 1 E2 / P0-1 / P0-5 | Spec ändern: „zustandslos (2026-07-28), 2025er-Clients stateless ohne Session“ und „`list_changed` für 2025er-Clients erst beim nächsten `tools/list`“? | ja; Push für 2026er-Clients über `subscriptions/listen` in Phase 1 einbauen (B9). Sessionful-Legacy nur, wenn ein Zielclient es nachweislich braucht. |
| 0a O1 | Registrierung nach dem ersten Nutzer sperren, bis Einladungen da sind? | ja, mit Mutex (B3). Wann kommen Einladung/Allowlist: Vorschlag Phase 1, Meilenstein 1.1 (B2). |
| B2 Ort der Admin-Funktionen | Admin-Plugin in 0a, Nutzerverwaltung in Phase 1 1.1? | ja. |
| B11 | Einzel-Token-Widerruf sofort wirksam (eine Query mehr) oder ≤ 5 min Verzögerung dokumentieren? | sofort wirksam. |
| 0b O1 | zweiter Pflichtclient | Cursor (lokal, ohne Tunnel), Fallback MCP Inspector; Claude Desktop/Web bei der ersten öffentlichen Instanz in Phase 1.4. |
| B18/B19 | Spec v0.4 mit den gesammelten Änderungen | ja, vor Start von 0b. |
| Spec-Frage 6 | stdio Idle 10 min, max. 5 Kinder | Phase-1-Defaults übernehmen. |

## Startreihenfolge

**Sofort (nach Einarbeitung der 0a-Korrekturen B1, B2, B3, B20 in den Plan):**
- 0a Task 1 (Gerüst; Node ≥ 24.15, TS 5.x/6.x), Task 2 (Tailwind/shadcn), Task 3 (Config/Master-Key).
- 0a Task 4 (DB-Schicht) und Task 5 (Auth-Fabrik, Schema-Generierung mit `admin()`): der PGlite-Spike (U2) ist erledigt (S1), `--dialect postgresql` geklärt (S2).

**Hängt noch an einem Spike im echten Nuxt-Build:**
- 0a Task 7: Init über memoisiertes `getDb()`-Promise (B1) und Kopie des Migrationsordners ins `.output` (R3) im gebauten Artefakt prüfen. Ob Nitro bei SIGTERM den `close`-Hook ruft (für A2, sauberes PGlite-Schließen), ist unverifiziert und hier mitzuprüfen.
- 0a Task 10/11: Rate-Limit-Schalter für Tests (B16) vorher festlegen.

**Vor Start von 0b entscheiden:**
- Schnittstellentabelle oben übernehmen (Pfade, `getDb`/`getAuth`, `requireUser`/`requireAdmin`, `/login`, Tabellenpräfix, Einstellungs-Tabelle, Test-Harness, `AuthContext` mit `role`, `ToolSource` mit `signal`).
- Spec v0.4 (B18, B19), E2.

**Vor Start von Phase 1 entscheiden:**
- B2 (Admin/Einladungen in 1.1), B4 (Umstiegstest), B5/B6/B8 (Supervisor-Härtung) in den Plan aufnehmen; E7-Liste festlegen.
