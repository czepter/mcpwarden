# Phase 0a (Fundament): Umsetzungsplan

Stand: 2026-11-04 (überarbeitet nach `docs/plans/review.md`; Zuständigkeit Frontend nach `docs/ui-abgleich.md` und `docs/plans/frontend.md` eingearbeitet) · Grundlage: `docs/spec.md` v0.3 (Phasen, P0-11, P0-10, P0-4, Technische Rahmenbedingungen); Schnittstellen nach der Abgleichtabelle im Review

## 1. Ziel und Abnahmekriterien

Ziel: tragfähige Daten- und Auth-Schicht (inklusive Rolle/Sperre über das `admin()`-Plugin), auf der 0b (OAuth-Provider) und Phase 1 (Gateway, Nutzerverwaltung) aufsetzen. Kein Gateway, keine Upstreams, kein OAuth-Provider.

**Zuständigkeit (bestätigt 2026-11-04):** Das Frontend-Agent baut **alle Vue-Dateien unter `app/**`** (Seiten, Layouts, Komponenten, Tailwind- und shadcn-vue-Einrichtung, Login- und Registrierungsseite). 0a liefert nur `server/**`, Tests, Konfiguration, Tooling, das Nuxt-Gerüst mit Platzhalter-`app.vue` und Beiträge zum Vertrag `shared/api-types.ts`. Details und Meilenstein "Gerüst steht" in Abschnitt 3.

Abnahme (alle automatisiert, siehe Abschnitt 6):

- [ ] A1 Registrierung und Login per E-Mail/Passwort funktionieren gegen PGlite (Standard, `DATABASE_URL` leer). Geprüft wird die HTTP-API (`/api/auth/*`), nicht eine Seite; die Seiten `/login` und `/register` baut das Frontend gegen diese API und nimmt sie selbst ab.
- [ ] A2 Neustart (SIGTERM, dann erneuter Start mit gleichem `DATA_DIR`) behält Nutzer; Login mit altem Passwort klappt. Voraussetzung: PGlite wird bei SIGTERM sauber geschlossen (Nitro-`close`-Hook oder eigener Signal-Handler, Spike in Task 7).
- [ ] A3 Derselbe Testsatz ist grün mit `DATABASE_URL=postgres://…` gegen einen Postgres-Container, ohne Code- oder Schemaänderung (`pnpm test:pg`, CI-Matrix).
- [ ] A4 Migrationen laufen beim Start idempotent (zweiter Start: kein Fehler, keine neue Migration).
- [ ] A5 App startet nicht ohne gültigen `MASTER_KEY`, `BETTER_AUTH_SECRET`, `BASE_URL` (Exit-Code ≠ 0, klare Meldung ohne Key-Inhalt).
- [ ] A6 Das Better-Auth-Schema (inklusive `admin()`-Spalten) ist aus Better Auth generiert (nicht von Hand), die Migrationen sind eingecheckt, CI prüft per `db:schema && db:generate && db:check && git diff --exit-code`, dass beides zum Stand passt.
- [ ] A7 Alle DB-Zugriffe laufen über genau einen Client pro Prozess (Test: parallele Anfragen gegen PGlite ohne Fehler).
- [ ] A8 Kein Request sieht eine nicht migrierte DB: Race-Test (Anfragen unmittelbar nach Prozessstart) liefert nie einen Schemafehler; `getDb()` löst erst nach der Migration auf (B1).
- [ ] A9 Der erste registrierte Nutzer hat `role=admin`; parallele Erst-Registrierungen ergeben genau einen Nutzer (Rest 403); danach ist die öffentliche Registrierung gesperrt; weitere Testnutzer entstehen über die Admin-API (B2, B3). `get-session` liefert `role` und `banned`.
- [ ] A10 "Gerüst steht": Task 1 ist abgeschlossen und liefert genau die Dateien aus Abschnitt 3.1, sodass das Frontend ohne Rückfrage starten kann (`pnpm install && pnpm build` grün, Alias `#shared/api-types` löst in `app/` und `server/` auf).

## 2. Geprüfte Versionen und Annahmen

Versionen geprüft am 2026-11-04 per `npm view` (Registry) und offizieller Doku (nuxt.com, better-auth.com, orm.drizzle.team, pglite.dev, shadcn-vue.com); die Versionen wurden im Review (S13) bestätigt.

| Paket | Version (latest) | Anmerkung |
|---|---|---|
| nuxt | 4.6.4 | Nitro 2 (`nitropack ^2.13.6` via `@nuxt/nitro-server`), h3 v1 (`^1.15.11`). Engines: `^22.22.3 \|\| ^24.15.0 \|\| >=26`. Lokal ist Node 24.13.0 installiert, also zu alt: auf >= 24.15 anheben. |
| better-auth | 1.7.17 | Drizzle-Adapter ist ein eigenes Paket `@better-auth/drizzle-adapter` 1.7.17 (Peer: `drizzle-orm ^0.45.2 \|\| >=1.0.0-rc.1`). |
| auth (CLI) | 1.7.17 | `pnpm dlx auth@1.7.17 generate`; das ältere `@better-auth/cli` (1.4.21) ist veraltet, nicht verwenden. |
| drizzle-orm | 0.45.4 (stabil) | Dist-Tag `rc` = 1.0.0-rc.5. Entscheidung: **0.45.x pinnen**, 1.0 erst nach Release. |
| drizzle-kit | 0.31.11 (stabil) | analog zu drizzle-orm. |
| @electric-sql/pglite | 0.5.15 | Pfad `dataDir` als String (Node: Dateisystem), `PGlite.create(dataDir)` wartet auf Ready. Single exclusive connection laut Doku. |
| pg | 8.23.1 | Treiber für echtes Postgres (`drizzle-orm/node-postgres`). |
| tailwindcss, shadcn-nuxt, shadcn-vue und weitere UI-Pakete | – | **nicht mehr Teil von 0a**: Einrichtung und Versionen führt das Frontend (`docs/plans/frontend.md`, Abschnitt 2). |
| vitest | 5.1.0 | Peer von better-auth erlaubt `^5`; `@nuxt/test-utils` 4.3.4 erlaubt laut Peer `^4 \|\| ^5` (Review S6). Trotzdem kein `@nuxt/test-utils`: ein Harness für alle Phasen (Abschnitt 6). |
| typescript | **5.9.x (oder 6.x)** | **Entscheidung (Review B20):** TS 5.9/6.x pinnen. `vue-tsc` 3.3.14 verlangt nur `>=5.0.0`, TS 7.0.2 ist mit `nuxi typecheck` unverifiziert; Wechsel auf 7 später als eigene Aufgabe. |

Verifiziert in der Doku:
- Drizzle + PGlite: `import { drizzle } from 'drizzle-orm/pglite'`, `drizzle({ client })` mit eigenem `PGlite`-Client; Migratoren existieren als `drizzle-orm/pglite/migrator` und `drizzle-orm/node-postgres/migrator` (im Paket 0.45.4 vorhanden).
- Better Auth Nuxt: Handler `server/api/auth/[...all].ts` mit `auth.handler(toWebRequest(event))` (`toWebRequest` ist der richtige Weg, Review S5), Client über `better-auth/vue`, Seiten-Middleware mit `return navigateTo(...)`, Session serverseitig über `auth.api.getSession({ headers })`.
- Better Auth Optionen: `BETTER_AUTH_SECRET` wird gelesen, in Produktion Fehler ohne Secret; `baseURL`, `trustedOrigins`, `rateLimit` (Standard nur in Produktion aktiv, Storage `memory`/`database`), `advanced.ipAddress.ipAddressHeaders`/`trustedProxies`, `databaseHooks.user.create.before`, `hooks.before` (`createAuthMiddleware`).
- Schema-Generierung: `pnpm dlx auth@1.7.17 generate --config <pfad> --output <datei> --adapter drizzle --dialect postgresql -y`. Ohne `--config` sucht die CLI `auth.ts` in `./`, `./lib`, `./utils` (auch unter `src`). Drizzle-Schema braucht keine Live-DB. `admin()` ergänzt `role`, `banned`, `ban_reason`, `ban_expires` (Review S3). Die CLI-Config braucht eine gültige `baseURL` (Review B12).

Durch den Review erledigt bzw. entschieden:
- **U1 erledigt (verifiziert):** `--dialect postgresql` (wird für Drizzle auf `pg` abgebildet; `auth generate --help`, Review S2, 2026-11-04). Generiertes Schema: `id text`, Spalten explizit snake_case (`email_verified`, `user_id`), daher kein `casing`-Flag.
- **U2 erledigt (verifiziert im Spike, ohne Nuxt):** Spike im Scratchpad des Reviews (2026-11-04, Node 24.13, better-auth 1.7.17 + `@better-auth/drizzle-adapter` 1.7.17 mit `provider: 'pg'` + drizzle-orm 0.45.4 + PGlite 0.5.15): Sign-up 200, Sign-in 200, 30 parallele `getSession` ok, `migrate()` zweimal ergibt 1 Eintrag in `drizzle.__drizzle_migrations`, Neustart mit gleichem `dataDir` ok (Review S1). **Nicht geprüft:** Lauf innerhalb Nuxt/Nitro und im gebauten Artefakt; dies wird in Task 5/7 wiederholt (siehe Spike unten), bei Abweichung gilt der Nuxt-Build-Befund.
- **U4 widerlegt:** Nitro (`nitropack@2.13.6`, `runNitroPlugins`) ruft Plugins ohne `await`; asynchrone Plugins laufen nebenläufig zum ersten Request (Review S4, B1). Konsequenz: Init als einmal memoisiertes Promise in `getDb()`, `getAuth()` wartet darauf, das Plugin stößt nur an (Task 4, 7).
- **U6, U7:** wie bisher, siehe unten.

**Noch unverifiziert** (im jeweiligen Task als Spike mit Abbruchkriterium geführt):
- U3 Ob ein in einem Nitro-Plugin geworfener Fehler den Prozess beendet (daher explizit `process.exit(1)` im `.catch` des angestoßenen Promises).
- U5 Regel-Pfadformat von `rateLimit.customRules` (`/sign-in/email`).
- U6 Verhalten von PGlite bei SIGKILL (Durability); getestet wird nur sauberer Shutdown.
- U7 Ob die CLI die Config mit TS-Pfad-Aliasen (`~~/`) lädt; Plan vermeidet Aliase in `auth.cli.ts` (relative Imports).
- U8 Ob Nitro bei SIGTERM den Hook `close` ruft (für sauberes `closeDb()`, A2). Fallback: eigener `process.on('SIGTERM')`-Handler im Init-Plugin, der `closeDb()` aufruft und danach beendet.
- U9 Ob ein `databaseHooks.user.create.before` auch bei `auth.api.createUser` (Admin-Plugin) feuert, oder ob die Sperre stattdessen in `hooks.before` auf den Pfad `/sign-up/email` gehört (Plan nimmt Letzteres an, siehe Task 8).
- U10 Ob ein Hook die Rolle `admin` beim ersten Nutzer setzen darf (Rückgabe `{ data: { …user, role: 'admin' } }` im `before`-Hook) bzw. ob `admin()`-Option `adminUserIds` o. ä. nötig ist.

Annahmen:
- Paketmanager pnpm, Node >= 24.15 (`.nvmrc`, `engines`). Branch `feat/phase-0a-foundation`, `git init` ist Teil von Task 1; Push erst nach vollständigem Stack (Projektregel), nichts in diesem Auftrag committet. Das Frontend-Agent (Branch `feat/frontend`) zweigt vom Gerüst-Commit aus Task 1 ab (Abschnitt 3.1); beide arbeiten im selben lokalen Repository (Annahme, z. B. getrennte Worktrees), der Gerüst-Commit muss dafür nicht gepusht werden.
- Zuständigkeit Vue/UI: siehe Abschnitt 1 und 3. 0a schreibt unter `app/` nur `app/app.vue` (Platzhalter); alles Weitere ist exklusiv Frontend.
- Keine Dunkelmodus-Arbeit in 0a (bestätigt 2026-11-04); auch kein `@nuxtjs/color-mode`.
- Passwort-Mindestlänge 12 Zeichen, serverseitig erzwungen (Better-Auth-Option `emailAndPassword.minPasswordLength: 12`, Spec P0-4; Option vor Einsatz gegen die Doku prüfen). Test: Registrierung mit 11 Zeichen wird mit 400 abgelehnt.
- Keine Mail-Funktionen: kein Mailversand, keine Passwort-Reset-Mail, keine E-Mail-Verifizierung, keine E-Mail-Änderung, keine Selbstlöschung des Kontos (bestätigt 2026-11-04). Task 5 schaltet die entsprechenden Better-Auth-Optionen nicht ein.
- Kein Dockerfile in 0a (P0-10 gehört zu Phase 1). 0a liefert aber die Vorbedingungen: Migrationsordner im Build-Output, `DATA_DIR` beschreibbar, `/healthz`.
- CI ist GitHub Actions (`.github/workflows/ci.yml`); falls anderer Host, nur Task 12 anpassen.
- Konfiguration über `process.env` (nicht `NUXT_*`-runtimeConfig, auch nicht `runtimeConfig` in `nuxt.config.ts`), weil die ENV-Namen aus der Spec fest sind (Schnittstellenentscheidung des Reviews: 0a-Variante, 0b E1 entfällt).
- Schemaänderungen strikt sequentiell (0a → 0b → Phase 1), keine parallelen Migrationen aus Branches (drizzle-kit-Journal kollidiert, Review B23); `db:check` ist Pflicht in CI.
- Migrationsreihenfolge laut Review: `0000` (0a, inklusive `admin()`), `0001` (0b OAuth-Tabellen), `0002` (0b eigene Tabellen), ab `0003` Phase 1. Namen vergibt drizzle-kit, Tabellen **ohne Präfix**.

Offene Punkte (Review-Empfehlung als Vorgabe übernommen):
- O1 **bestätigt 2026-11-04:** Registrierung in 0a **nach dem ersten Nutzer gesperrt**, abgesichert durch einen prozessweiten Mutex (B3); der erste Nutzer erhält `role=admin`. Einladungen, Nutzerliste, Sperren, Löschen und `user-lifecycle.ts` folgen in Phase 1, Meilenstein 1.1. **Einladung ist künftig ein Token-Link** (`/invite/<token>`, 7 Tage gültig, optional an eine E-Mail gebunden; bestätigt 2026-11-04, ersetzt die E-Mail-Allowlist). Das betrifft 0a nur an der Sperre: Die Entscheidung "darf sich jemand registrieren" liegt hinter genau einer Funktion `canRegister()` (Task 8), die in Phase 1 um die Token-Prüfung erweitert wird, ohne den Hook oder den Mutex umzubauen. Wie der Token zur Sperre gelangt (Feld im Sign-up-Body oder eigener Annahme-Endpunkt), entscheidet Phase 1; 0a legt sich nicht fest.
- O2 **bestätigt 2026-11-04:** Ort der Admin-Funktionen: `admin()`-Plugin, Rolle/`banned` im Schema, `requireAdmin` in 0a; Nutzerverwaltung in Phase 1 1.1 (B2).
- O3 OAuth-Provider-Tabellen: 0a generiert nur Kernschema plus `admin()` (user, session, account, verification; `role`, `banned`, `ban_reason`, `ban_expires` an `user`). Die Tabellen von `mcp()`/`jwt()` (jwks, oauth_client, oauth_resource, oauth_client_resource, oauth_refresh_token, oauth_access_token, oauth_consent, oauth_client_assertion) kommen in 0b als Migration 0001. Das ist nachträglich möglich (Review S3, Empfehlung "ja").
- O4 Umstiegstest PGlite → Postgres (P0-11) gehört laut Review (B4) zu **Phase 1** und ist **nicht** Teil der 0a-Abnahme. Der Postgres-Container-Test der Login-Abnahme (A3) bleibt in 0a. Was 0a für den Umstiegstest liefern muss, steht in Abschnitt 8 (Übergabe). Hinweis: `dumpDataDir()` liefert einen Tarball, kein SQL; `pgDump` aus `@electric-sql/pglite-tools` 0.4.15 erzeugt SQL-Dump mit Daten (Review S11, Import in Postgres noch nicht getestet).
- O5 **bestätigt 2026-11-04:** ein zusätzlicher Test-Schalter `RATE_LIMIT=off` (Default: an) in der ENV-Liste, weil das Build `NODE_ENV=production` hat und das Better-Auth-Rate-Limit dort sonst die Tests mit 429 trifft (B16). Muss in Spec v0.4 (P0-10) aufgenommen werden; `STDIO_MODE` und `TRUST_PROXY` gehören Phase 1 und sind nicht Teil von 0a.
- O6 **bestätigt 2026-11-04:** TypeScript 5.9.x statt 7.x (B20); TS-7-Wechsel als eigene Aufgabe später.

## 3. Verzeichnisstruktur (zu erzeugen)

```
mcpwarden/
├── .nvmrc                          # 24 (>= 24.15)
├── .gitignore                      # node_modules, .nuxt, .output, data/, .env
├── .env.example                    # alle sechs Spec-ENV-Namen plus RATE_LIMIT (Test), ohne echte Werte
├── package.json                    # Skripte, engines, gepinnte Versionen
├── nuxt.config.ts                  # GEMEINSAM, getrennte Blöcke (Abschnitt 3.2): hier 0a-Block mit nitro preset node-server, migrations-Kopierhook
├── tsconfig.json                   # Nuxt-Standard (extends .nuxt/tsconfig.json)
├── eslint.config.mjs               # Grundkonfiguration (Task 1); Frontend ergänzt Regeln nur für app/**
├── drizzle.config.ts               # dialect postgresql, schema, out
├── compose.test.yaml               # nur Postgres für Tests (kein App-Compose, das ist Phase 1)
├── .github/workflows/ci.yml        # (Frontend hat eigene Datei ui.yml)
├── shared/
│   └── api-types.ts                # GETEILTER VERTRAG: 0a legt leeres Grundgerüst an (Task 1), Regeln Abschnitt 3.3
├── app/
│   └── app.vue                     # nur Platzhalter (Task 1); alles Weitere unter app/ gehört dem Frontend
├── server/
│   ├── api/auth/[...all].ts        # Sign-up-Requests laufen im Mutex
│   ├── routes/{healthz,readyz}.get.ts
│   ├── plugins/00-init.ts          # stößt getDb() an, Fail-fast, Shutdown-Hook; weitere Plugins ab 10-…
│   ├── utils/
│   │   ├── config.ts               # getConfig()
│   │   ├── master-key.ts           # getMasterKey()
│   │   ├── mutex.ts                # prozessweiter Promise-Chain-Mutex (Sign-up)
│   │   └── session.ts              # requireUser(event), requireAdmin(event)
│   ├── db/
│   │   ├── index.ts                # getDb() (Init-Promise inkl. Migration), closeDb(), Typ Db, dbBackend
│   │   ├── migrate.ts              # runMigrations(db)
│   │   ├── schema/index.ts         # re-export
│   │   ├── schema/auth.ts          # GENERIERT aus Better Auth (inkl. admin())
│   │   └── migrations/             # drizzle-kit Ausgabe, eingecheckt
│   └── auth/
│       ├── options.ts              # buildAuthOptions(cfg): Plugins (admin), Felder, Hooks (ohne DB)
│       ├── registration.ts         # canRegister(): die eine Stelle der Registrierungssperre (Phase 1: Token-Einladung)
│       ├── index.ts                # getAuth() (async, memoisiert, wartet auf getDb())
│       └── auth.cli.ts             # nur für `auth generate`, setzt baseURL
├── scripts/
│   ├── init-env.sh                 # erzeugt lokale .env aus .env.example mit Zufallswerten (Task 1)
│   ├── gen-auth-schema.sh          # auth generate, deterministisch
│   └── wait-postgres.sh            # optional, falls `--wait` im Healthcheck nicht reicht
└── tests/
    ├── unit/{config,master-key}.test.ts
    ├── integration/
    │   ├── global-setup.ts         # Backend wählen, Temp-DATA_DIR bzw. frische Postgres-DB
    │   ├── harness.ts              # startServer(env), stopServer(), api(), signUpFirstAdmin(), createUser()
    │   ├── auth.test.ts            # A1, A7, A9
    │   ├── restart.test.ts         # A2, A4
    │   ├── startup-race.test.ts    # A8
    │   └── startup-checks.test.ts  # A5
    └── vitest.config.ts
```

Testordner ist `tests/` (Review-Entscheidung; 0b und Phase 1 übernehmen Harness und Variablen `TEST_BACKEND`, `TEST_PG_ADMIN_URL`). `tests/unit`, `tests/integration` und `tests/vitest.config.ts` gehören dem Backend; die UI-Tests des Frontends liegen getrennt unter `tests/ui/**`.

### 3.1 Meilenstein "Gerüst steht" (Ende von Task 1)

Task 1 läuft **vor allem anderen** und endet mit einem eigenen Commit auf `feat/phase-0a-foundation` (Betreff z. B. `chore: nuxt scaffold`). Ab diesem Commit darf das Frontend starten und zweigt davon ab. Die Tasks 2 bis 12 sind dafür **nicht** nötig. Task 1 liefert genau diese Dateien, nicht mehr:

| Datei | Inhalt | Danach |
|---|---|---|
| `package.json` | `name`, `private`, `type: module`, `packageManager` (pnpm), `engines.node`, gepinnte Versionen von `nuxt`, `vue`, `typescript` (5.9.x), `vue-tsc`, ESLint-Tooling; Skripte `dev`, `build`, `preview`, `typecheck` (`nuxi typecheck`), `lint` | gemeinsam; Frontend ergänzt eigene Abhängigkeiten und Skripte mit Präfix `ui:`, 0a eigene (`db:*`, `test*`) |
| `pnpm-lock.yaml` | zum Gerüst passend | gemeinsam, Konflikte bei Neuaufbau |
| `nuxt.config.ts` | `compatibilityDate`, `devtools`, `nitro: { preset: 'node-server' }`; zwei kommentierte Blöcke `// --- Backend (0a) ---` und `// --- Frontend ---` (letzter leer); `ssr` bleibt auf Nuxt-Standard (Frontend setzt es selbst) | gemeinsam, Regeln in 3.2 |
| `tsconfig.json` | Nuxt-Standard mit Verweis auf `.nuxt/tsconfig.json` | 0a |
| `eslint.config.mjs` | Flat-Config-Grundlage (Paketwahl bei Umsetzung per `npm view` prüfen, **unverifiziert**); `lint` läuft ohne Fehler | gemeinsam, Frontend ergänzt Regeln für `app/**` |
| `.nvmrc`, `.gitignore`, `.env.example` | wie Task 1 | 0a |
| `scripts/init-env.sh` | schreibt `.env` mit frisch erzeugtem `BETTER_AUTH_SECRET` und `MASTER_KEY` (`openssl rand`) und `BASE_URL=http://localhost:3000`, überschreibt eine vorhandene `.env` nie | 0a |
| `shared/api-types.ts` | Kopfkommentar mit den Regeln aus 3.3 und `export {}` | gemeinsamer Vertrag |
| `app/app.vue` | Platzhalter, z. B. `<template><div>mcpwarden</div></template>`; kein `NuxtPage`, keine Styles | **Frontend ersetzt sie** (exklusiv) |
| `server/`, `tests/`, `scripts/` | nur Ordner, soweit Task 1 sie braucht; sonst leer | 0a |

Nicht Teil des Gerüsts: Tailwind, `@tailwindcss/vite`, `shadcn-nuxt`, `components.json`, `@nuxtjs/color-mode`, Schriftpakete, `lib/utils.ts`, jede Datei unter `app/` außer `app.vue`. Das alles legt das Frontend an.

**Abnahme des Meilensteins:** `pnpm install && pnpm build` grün, `node .output/server/index.mjs` liefert auf `GET /` 200, `pnpm typecheck` und `pnpm lint` ohne Fehler, ein Testimport `#shared/api-types` löst in `app/` und `server/` auf (Alias-Name aus der Nuxt-Doku, im Repo prüfen; der Testimport wird nicht eingecheckt). Dann Rückmeldung an das Frontend mit dem Commit.

**Wichtig für `ui:dev`:** Das Frontend startet im Mock-Modus trotzdem den Nitro-Server, und `00-init.ts` (Task 7) beendet den Prozess ohne gültige ENV (A5). Deshalb legt das Frontend einmalig `pnpm env:init` (ruft `scripts/init-env.sh`) vor `ui:dev` aus; die Variante, `00-init.ts` im Mock-Modus zu überspringen, ist verworfen, weil sie Produktionscode vom Frontend-Schalter abhängig machen würde. (Annahme, mit dem Frontend abzustimmen.) Das Skript `env:init` gehört in `package.json` (0a, Task 1).

### 3.2 Eigentum nach dem Meilenstein

| Bereich | Eigentümer | Regel |
|---|---|---|
| `app/**` (inklusive `app.vue`, Layouts, Seiten, Komponenten, Middleware, Plugins, `lib/auth-client.ts`, Tailwind-CSS), `components.json`, `mocks/**`, `tests/ui/**`, `public/mockServiceWorker.js`, `.github/workflows/ui.yml` | **Frontend, exklusiv** | 0a und die Backend-Phasen legen dort nichts an und ändern nichts. Fehlt etwas, Wunsch an das Frontend. |
| `server/**`, `supervisor/**`, `tests/unit/**`, `tests/integration/**`, `tests/vitest.config.ts`, `drizzle.config.ts`, `compose*.yaml`, `Dockerfile`, Migrationen, `scripts/**`, `.github/workflows/ci.yml`, `.env.example`, `.nvmrc` | **Backend (0a, 0b, Phase 1)**, exklusiv | Frontend ändert dort nichts. |
| `package.json`, `nuxt.config.ts`, `eslint.config.mjs`, `pnpm-lock.yaml`, `README.md` | gemeinsam | Jeder fasst nur eigene Schlüssel bzw. Abschnitte an, kleine Commits. In `nuxt.config.ts` gehören dem Backend `nitro`, `hooks` (Kopierhook), `compatibilityDate`, `devtools`; dem Frontend `ssr`, `modules` (nur `shadcn-nuxt`, `@nuxtjs/color-mode`), `css`, `vite.plugins`, `shadcn`, `colorMode`, `app.head`. Das Backend legt keine eigenen `runtimeConfig`-Schlüssel an (Konfiguration über `process.env`). In `package.json` gehören dem Backend `engines`, `db:*`, `test*`, `env:init`, dem Frontend `ui:*` und UI-Abhängigkeiten. `README.md`: Backend schreibt "Entwicklung", Frontend den Abschnitt "Frontend". |
| `shared/api-types.ts` | gemeinsamer Vertrag | Regeln in 3.3 |

### 3.3 Vertrag `shared/api-types.ts`

Angelegt von 0a in Task 1 als leere Datei mit Kopfkommentar; das Frontend legt die Erstfassung der Typen an (Quelle: `docs/ui-abgleich.md`, Abschnitt 5). 0a trägt nur die Typen für die eigenen Routen bei (Task 8: `Role`, `AuthSessionUser`, `ApiErrorBody`, Code der gesperrten Registrierung); das Frontend definiert diese Namen nicht noch einmal. Regeln, die als Kopfkommentar in der Datei stehen:

1. Nur Typen und Konstanten; keine Laufzeitlogik, kein Import von Vue oder Nitro; Import überall als `#shared/api-types`.
2. Zeitstempel als ISO-8601-String, Zeitdauern in Millisekunden mit Suffix `Ms`, Anteile als Zahl 0 bis 1. Secrets kommen in keinem Antworttyp vor (nur `hasSecret: boolean`).
3. Feld hinzufügen ist abwärtskompatibel und braucht nur den Hinweis im Commit-Betreff. Umbenennen oder Entfernen verlangt vorherige Absprache zwischen Frontend und dem Backend-Agenten der betroffenen Route und ändert Typ, Mock (Frontend) und Route im selben Commit.
4. Wer eine Route baut oder ändert, ergänzt den Typ im selben Commit und prüft die Antwort mit `satisfies` gegen den Typ. Änderungen an der Datei tragen den Betreff-Präfix `contract:`.
5. Das Backend baut keine Antwort, die vom Typ abweicht; weicht es bewusst ab, wird der Typ geändert (Regel 3), nicht die Abweichung verschwiegen.

## 4. Aufgaben

Reihenfolge ist abhängig: 1 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 11 → 12. Task 2 und Task 9 sind ans Frontend abgegeben (Nummern bleiben erhalten, weil 0b und Phase 1 darauf verweisen). **Task 1 hat Vorrang** und ist der Meilenstein "Gerüst steht" (Abschnitt 3.1): Ab seinem Abschluss läuft das Frontend parallel zu Task 3 bis 12. Freigegeben zum sofortigen Start sind Task 1, 3, 4, 5 (U1/U2 erledigt, Review "Startreihenfolge"). Der Spike in Task 7 (Init-Promise, Migrationskopie, SIGTERM) hängt am echten Nuxt-Build und sollte früh laufen, sobald Task 4/5 stehen; die Rate-Limit-Entscheidung (O5) muss vor Task 10 fallen.

### Task 1: Repo und Nuxt-Gerüst (Meilenstein "Gerüst steht")
- Zweck: lauffähiges Nuxt-4-Projekt mit Node-Preset, auf dem das Frontend aufsetzen kann. Task 1 läuft zuerst und liefert **genau** die Dateien aus Abschnitt 3.1.
- Dateien: `package.json`, `pnpm-lock.yaml`, `nuxt.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.nvmrc`, `.gitignore`, `.env.example`, `scripts/init-env.sh`, `shared/api-types.ts` (leer mit Regeln), `app/app.vue` (Platzhalter).
- Schritte:
  1. Node >= 24.15 aktivieren; `git init`, Branch `feat/phase-0a-foundation`.
  2. `pnpm create nuxt@latest` (Minimal-Template) im bestehenden Ordner (`docs/` bleibt) oder Gerüst per Hand anlegen; danach alle Dateien entfernen, die nicht in Abschnitt 3.1 stehen.
  3. Versionen exakt pinnen (Tabelle Abschnitt 2), **TypeScript 5.9.x**; `engines.node` setzen. Skripte `dev`, `build`, `preview`, `typecheck`, `lint`, `env:init`.
  4. `nitro: { preset: 'node-server' }` explizit setzen. `ssr` nicht setzen (Nuxt-Standard; das Frontend entscheidet, `ui:dev` nutzt SPA). Die Datei trägt die zwei Kommentarblöcke aus 3.2.
  5. `.env.example` mit `BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL`, `DATA_DIR`, `ALLOWED_ORIGINS` und je einer Zeile Erklärung; `RATE_LIMIT` (nur Tests, O5) als auskommentierte Zeile. `scripts/init-env.sh` erzeugt daraus lokal eine `.env` (Zufallswerte, keine Werte im Repo).
  6. `shared/api-types.ts` mit Kopfkommentar (Regeln aus 3.3) und `export {}`.
  7. `app/app.vue` als Platzhalter; keine weiteren Dateien unter `app/`.
  8. Eigener Commit `chore: nuxt scaffold`; Rückmeldung an das Frontend mit dem Commit (Meilenstein erreicht).
- Prüfung: `pnpm install && pnpm build && node .output/server/index.mjs` startet, `GET /` liefert 200; `pnpm typecheck`, `pnpm lint`; Testimport `#shared/api-types` in `app/` und `server/` (nicht eingecheckt).
- DoD: Build grün, `.output/server/index.mjs` startet unter Node 24.15+, `nuxi typecheck` ohne Fehler mit TS 5.9, Datei-Liste entspricht Abschnitt 3.1 (kein Tailwind, kein shadcn, nichts unter `app/` außer `app.vue`), A10 erfüllt.

### Task 2: Tailwind und shadcn-vue (entfällt in 0a, ans Frontend abgegeben)
- Bestätigt 2026-11-04: Einrichtung von Tailwind, `shadcn-nuxt`/`shadcn-vue`, `components.json`, Basiskomponenten und Design-Tokens führt das Frontend (`docs/plans/frontend.md`, Aufgabe 2). 0a liefert dafür nichts außer dem Gerüst aus Task 1. Die Nummer bleibt als Verweis stehen.
- Folge: Das Frontend wartet nicht auf Task 2, sondern auf den Meilenstein am Ende von Task 1 (`frontend.md` Annahme A2 nennt noch "0a Aufgabe 1 und 2"; dort anzupassen, nicht in diesem Plan).

### Task 3: Konfiguration und Master-Key
- Zweck: Fail-fast-Prüfung aller ENV beim Start (A5).
- Dateien: `server/utils/config.ts`, `server/utils/master-key.ts`, `tests/unit/config.test.ts`, `tests/unit/master-key.test.ts`.
- Schritte:
  1. `getConfig()` liest einmalig `process.env` und gibt ein eingefrorenes Objekt zurück: `baseUrl: URL`, `betterAuthSecret: string`, `masterKey: Buffer`, `databaseUrl: string | undefined` (leer = undefined), `dataDir: string` (Default `./data`), `allowedOrigins: string[]` (kommagetrennt, Default `[baseUrl.origin]`, jeder Eintrag als Origin geparst), `rateLimitEnabled: boolean` (`RATE_LIMIT=off` → false, sonst true; O5).
  2. Regeln: `BASE_URL` Pflicht, `https:` außer Host `localhost`/`127.0.0.1`/`[::1]`; `BETTER_AUTH_SECRET` Pflicht, >= 32 Zeichen; `MASTER_KEY` Pflicht, genau 32 Byte als Base64 oder 64 Hex-Zeichen (Format ist Annahme, in `.env.example` dokumentiert, Erzeugung `openssl rand -base64 32`); `DATABASE_URL` wenn gesetzt muss mit `postgres://` oder `postgresql://` beginnen; `RATE_LIMIT` nur `off` oder leer.
  3. Fehler sammeln und als eine Meldung werfen (`ConfigError`), die nur Variablennamen und Regel nennt, nie Werte.
  4. `getMasterKey()` gibt das `Buffer` aus `getConfig()` zurück. **Keine** Ableitung pro Nutzer in dieser Datei: `deriveUserKey`/`decryptSecret` gehören Phase 1 nach `server/gateway/crypto/secrets.ts` (Review-Entscheidung).
- Prüfung: `pnpm vitest run tests/unit` mit Fällen: gültig, fehlend, falsche Länge, `http://` nicht-localhost, `http://localhost`, leere `DATABASE_URL`, `RATE_LIMIT=off`, Fehlermeldung enthält den Key nicht.
- DoD: Unit-Tests grün, Meldung enthält keinen Secret-Wert (Test sucht den Testkey im Meldungstext).

### Task 4: DB-Schicht (PGlite oder Postgres, ein Client, Init-Promise)
- Zweck: einheitliche `Db`-Schnittstelle, Umschaltung nur per `DATABASE_URL` (P0-11); Migration läuft genau einmal innerhalb von `getDb()`, damit kein Request vor Abschluss durchkommt (B1, A8).
- Dateien: `server/db/index.ts`, `server/db/migrate.ts` (Aufruf aus `getDb()`, Inhalt Task 7), `server/db/schema/index.ts`.
- Schritte:
  1. Abhängigkeiten: `drizzle-orm`, `@electric-sql/pglite`, `pg`, Dev: `@types/pg`.
  2. `getDb()`: asynchron, **ein einmal erzeugtes Promise** (memoisiert über `globalThis`, schützt vor Doppelinstanz bei Dev-HMR). Das Promise macht in dieser Reihenfolge: `getConfig()` → Client erzeugen → `runMigrations(db)` → `db` zurückgeben. Ohne `DATABASE_URL`: `PGlite.create(join(dataDir, 'pgdata'))` + `drizzle({ client, schema })` aus `drizzle-orm/pglite`. Mit URL: `new Pool({ connectionString })` + `drizzle(pool, { schema })` aus `drizzle-orm/node-postgres`. Alle Aufrufer (Auth, Routen, spätere Plugins) bekommen die `Db` damit erst nach der Migration; schlägt sie fehl, bleibt das Promise rejected und jeder Aufruf scheitert.
  3. Gemeinsamer Typ `Db = PgDatabase<any, typeof schema>` (Basisklasse beider Treiber); alle Konsumenten typisieren nur gegen `Db`.
  4. Export `dbBackend: 'pglite' | 'postgres'` und `closeDb()` (PGlite `close()`, Pool `end()`; idempotent, setzt das Promise zurück).
  5. Regeln im Dateikopf: kein PGlite-spezifisches SQL, keine Extensions, keine langen Transaktionen; kein `withTx`-Helfer (YAGNI), kein `casing`-Flag (Schema benennt Spalten explizit).
- Prüfung: `select 1` in beiden Backends per Skript (`pnpm tsx`-Einzeiler oder Test in Task 10); zwei parallele `getDb()`-Aufrufe vor Abschluss führen die Migration nur einmal aus.
- DoD: Beide Pfade liefern `select 1`; zweiter `getDb()`-Aufruf liefert dieselbe Instanz; Migration einmal pro Prozess.

### Task 5: Better-Auth-Fabrik, `admin()`-Plugin und Schema-Generierung
- Zweck: Auth-Konfiguration einmal definieren, daraus das Drizzle-Schema (inklusive Rolle/Sperre) generieren (A6, A9).
- Dateien: `server/auth/options.ts`, `server/auth/index.ts`, `server/auth/auth.cli.ts`, `scripts/gen-auth-schema.sh`, `server/db/schema/auth.ts` (generiert), `server/db/schema/index.ts`.
- Schritte:
  1. Abhängigkeiten: `better-auth`, `@better-auth/drizzle-adapter`; CLI nicht global, sondern per `pnpm dlx auth@1.7.17`.
  2. `options.ts` exportiert `buildAuthOptions(cfg)` ohne DB: `baseURL`, `secret`, `trustedOrigins: cfg.allowedOrigins`, `emailAndPassword: { enabled: true }` (ohne `sendResetPassword`, ohne `requireEmailVerification`; `user.changeEmail` und `user.deleteUser` bleiben aus, weil es keine Mail-Funktionen und keine Selbstlöschung gibt; Optionsnamen **unverifiziert**, beim Umsetzen gegen die Doku prüfen), `plugins: [admin()]` (liefert `role`, `banned`, `ban_reason`, `ban_expires`), Registrierungssperre und Erst-Nutzer-Admin (Task 8, O1), `rateLimit: { enabled: cfg.rateLimitEnabled, … customRules }` für Sign-in/Sign-up (U5), `advanced.ipAddress.ipAddressHeaders` Default belassen. Weitere Plugins (`jwt()`, `mcp()`) ergänzt 0b hier.
  3. `index.ts`: `getAuth()` async und memoisiert: `await getDb()` (damit nach der Migration) → `betterAuth({ ...buildAuthOptions(cfg), database: drizzleAdapter(db, { provider: 'pg', schema }) })`. Spike (U2 im Nuxt-Build wiederholen): läuft `provider: 'pg'` mit PGlite im gebauten Artefakt nicht, Abbruch und Rückmeldung an die Spec; Kysely/pg-Adapter-Rückfall ist nicht gewünscht.
  4. `auth.cli.ts` baut dieselben Optionen (inklusive `admin()`) mit festen Dummy-Werten, **gültiger `baseURL`** (sonst Abbruch "Invalid URL", B12) und `{} as never` als DB, nur relative Imports (U7); Datei wird nie zur Laufzeit geladen.
  5. `gen-auth-schema.sh`: `pnpm dlx auth@1.7.17 generate --config server/auth/auth.cli.ts --output server/db/schema/auth.ts --adapter drizzle --dialect postgresql -y`. Ergebnis mit Kopfkommentar "generiert, nicht editieren".
  6. Schema-Re-Export in `schema/index.ts`; eigene Tabellen (Upstreams, Tokens, Audit, Einstellungen) kommen erst in 0b/Phase 1, ohne Tabellenpräfix.
- Prüfung: Skript zweimal laufen lassen, `git diff --exit-code server/db/schema/auth.ts` (deterministisch). Tabellen user, session, account, verification vorhanden; `user` hat `role`, `banned`, `ban_reason`, `ban_expires`.
- DoD: Schema committet, Skript reproduzierbar, `getAuth()` kompiliert.

### Task 6: drizzle-kit-Konfiguration und erste Migration
- Zweck: versionierte Migrationen (A6).
- Dateien: `drizzle.config.ts`, `server/db/migrations/0000_*.sql` + `meta/`, `package.json`-Skripte.
- Schritte:
  1. `drizzle.config.ts`: `dialect: 'postgresql'`, `schema: './server/db/schema/index.ts'`, `out: './server/db/migrations'`. Keine `dbCredentials` nötig, da nur `generate`.
  2. Skripte: `db:schema` (Task 5), `db:generate` (`drizzle-kit generate`), `db:check` (`drizzle-kit check`, in CI Pflicht wegen Journal-Kollisionen, B23).
  3. `pnpm db:generate --name init` ausführen, SQL prüfen (nur Standard-Postgres-DDL; enthält bereits die `admin()`-Spalten). Das ist Migration `0000`.
  4. Regel dokumentieren: Migrationen werden nie nachträglich editiert; Schemaänderung = `db:schema` + `db:generate`; Schemaänderungen strikt sequentiell (0a → 0b → Phase 1), keine parallelen Migrations-Branches.
- Prüfung: `pnpm db:generate` erneut ausführen meldet "nothing to migrate"; CI-Schritt: `db:schema && db:generate && db:check && git diff --exit-code`.
- DoD: `0000_init.sql` eingecheckt, Leerlauf-Generierung ohne Diff.

### Task 7: Migration beim Start, Init-Plugin, Health, Shutdown (mit Spike im Build)
- Zweck: Startsequenz mit Fail-fast; Readiness (A4, A5, A7, A8).
- Dateien: `server/db/migrate.ts`, `server/plugins/00-init.ts`, `server/routes/healthz.get.ts`, `server/routes/readyz.get.ts`, `nuxt.config.ts` (Kopierhook).
- **Spike zuerst (im gebauten Nuxt, nicht im Dev-Server), Abbruchkriterium: eines der drei Ergebnisse fällt anders aus, dann Plan anpassen und zurückmelden:**
  1. Init-Promise: Prozess starten und sofort (vor Ende der Migration) Anfragen auf `/api/auth/get-session` feuern. Erwartung: kein Schemafehler, Antworten erst nach der Migration (U4 widerlegt, Review S4).
  2. Migrationsordner: wird `server/db/migrations` per Kopierhook nach `.output/server/migrations` kopiert und zur Laufzeit gefunden (R3)?
  3. SIGTERM: ruft Nitro den `close`-Hook, sodass `closeDb()` PGlite schließt (U8)? Sonst eigener `process.on('SIGTERM')`-Handler.
- Schritte:
  1. `runMigrations(db)`: je Backend `migrate` aus `drizzle-orm/pglite/migrator` bzw. `drizzle-orm/node-postgres/migrator` mit `migrationsFolder` aus `resolveMigrationsDir()`: ENV-frei, Default `<cwd>/server/db/migrations` im Dev, im Build `.output/server/migrations`. Aufgerufen wird sie ausschließlich aus dem Init-Promise von `getDb()` (Task 4), nie aus dem Plugin.
  2. Nitro-Hook `compiled` (oder `nitro.hooks`) kopiert `server/db/migrations` nach `.output/server/migrations`; Pfad zur Laufzeit relativ zu `import.meta.url` des Server-Bundles auflösen (im Build testen, nicht nur im Dev).
  3. `00-init.ts` startet nur: `getConfig(); getMasterKey(); getDb().then(() => getAuth()).then(markReady).catch((e) => { console.error(…); process.exit(1) })` (U3). Das Plugin wartet **nicht** darauf (Nitro tut es ohnehin nicht); Absicherung der Requests liegt in `getDb()`/`getAuth()`. Synchrone Config-Fehler (A5) beenden den Prozess ebenfalls mit Exit-Code 1. Beim Nitro-Hook `close` (oder SIGTERM-Handler, U8): `closeDb()`.
  4. `/healthz`: 200 wenn `select 1` klappt (über `getDb()`), sonst 503. `/readyz`: 200 erst nach `markReady()`, sonst 503. Antworten ohne Details (öffentlich). Phase 1 ändert diese Dateien (Supervisor-Check).
  5. Migrationen idempotent: Drizzle führt bereits angewendete nicht erneut aus; zusätzlich Test (A4).
- Prüfung: manuell `MASTER_KEY=… node .output/server/index.mjs` zweimal; `curl /readyz`; ohne `MASTER_KEY` → Exit-Code 1; Race-Test (A8).
- DoD: Start, Neustart, Fehlstart verhalten sich wie A4/A5/A8; Spike-Ergebnisse (Datum, Umgebung) im Plan vermerkt.

### Task 8: Auth-Route, Registrierungssperre, Admin und Server-Helper
- Zweck: Better-Auth-Endpunkte unter `/api/auth/*`, atomare Registrierungssperre, erster Nutzer = Admin, wiederverwendbare Sessionprüfung für 0b/Phase 1 (A9).
- Dateien: `server/api/auth/[...all].ts`, `server/utils/session.ts`, `server/utils/mutex.ts`, `server/auth/options.ts` (Hooks), `server/auth/registration.ts`, `shared/api-types.ts` (Beitrag, Schritt 6).
- Schritte:
  1. Handler: `const auth = await getAuth(); return auth.handler(toWebRequest(event))` (so in der Better-Auth-Nuxt-Doku, h3 v1). Requests auf `/sign-up/email` laufen **innerhalb des prozessweiten Mutex** (`withMutex(() => auth.handler(...))`, einfacher Promise-Chain-Mutex in `mutex.ts`; ponytail: Single-Instance-Annahme, bei Mehrfachinstanzen auf DB-Ebene lösen). Damit ist "zählen, prüfen, anlegen" atomar und die Sperre gegen das `count(*)`-Race gesichert (B3).
  2. Sperre in `options.ts` per `hooks.before` (`createAuthMiddleware`) nur für den Pfad `/sign-up/email`. Der Hook ruft `canRegister()` aus `server/auth/registration.ts` auf und wirft bei `{ ok: false }` einen `APIError` (403) "Registrierung geschlossen" mit stabilem Code `REGISTRATION_CLOSED` (Feld und Antwortform von Better Auth **unverifiziert**, im Spike prüfen; der Code steht als Konstante in `shared/api-types.ts`, damit das Frontend die Meldung zuordnen kann). 0a-Implementierung von `canRegister()`: Nutzer zählen (`select count(*)` über `getDb()`), bei > 0 `{ ok: false, code: 'REGISTRATION_CLOSED' }`. Signatur: `canRegister(ctx: { email: string; inviteToken?: string }): Promise<{ ok: true } | { ok: false; code: string }>`; `inviteToken` wertet 0a nicht aus. Phase 1 ersetzt nur den Inhalt (Token-Einladung `/invite/<token>`, 7 Tage, optional an E-Mail gebunden) und entscheidet, wie das Token in `ctx` gelangt; Hook, Mutex und Pfad bleiben. Die Sperre hängt bewusst nicht an `databaseHooks.user.create.before`, damit `auth.api.createUser` (Admin) weiter funktioniert (U9, im Spike prüfen).
  3. Erster Nutzer = Admin: `databaseHooks.user.create.before` setzt `role: 'admin'`, wenn noch kein Nutzer existiert (innerhalb des Mutex, U10). Alle späteren Nutzer entstehen über die Admin-API mit Rolle `user`.
  4. `requireUser(event)`: `auth.api.getSession({ headers: event.headers })`, sonst `createError({ statusCode: 401 })`; gibt `{ user, session }` zurück. `requireAdmin(event)`: wie `requireUser`, zusätzlich `user.role === 'admin'` und `!user.banned`, sonst 403. Beide in `server/utils/session.ts` (ein Name für alle Phasen, Review-Entscheidung; 0b/Phase 1 bauen `getSessionOrNull` o. ä. nur bei Bedarf darauf).
  5. Testnutzer: der Harness legt weitere Nutzer über die Admin-API an (`POST /api/auth/admin/create-user` mit der Admin-Session des ersten Nutzers, HTTP-Entsprechung zu `auth.api.createUser`), Helfer `createUser()` in `tests/integration/harness.ts`.
  6. Beitrag zum Vertrag `shared/api-types.ts` (Abschnitt 3.3): `Role` (`'admin' | 'user'`), `AuthSessionUser` (`id`, `name`, `email`, `role`, `banned`), `ApiErrorBody` (`statusCode`, `statusMessage`, `data?: { code?: string; field?: string; message?: string }`, Form ist Wunsch des Frontends, E10, für `/api/auth/*` die Form von Better Auth, im Spike prüfen) und die Konstante `REGISTRATION_CLOSED`. Die Antwort von `get-session` wird im Test mit `satisfies`-ähnlicher Prüfung (Feld `role` vorhanden) abgesichert.
  7. Sitzungs-Selbstverwaltung für `/settings` (Frontend): Better-Auth-Kern stellt `update-user`, `change-password`, `list-sessions`, `revoke-session` bereit (Namen **unverifiziert**). 0a baut nichts dazu, prüft aber im Rauchtest (`auth.test.ts`) je Endpunkt, dass er für eine angemeldete Sitzung antwortet, und meldet abweichende Namen oder Formen an das Frontend. Keine Mail-Funktionen (Abschnitt 2).
- Prüfung: `curl -X POST /api/auth/sign-up/email` (JSON `name,email,password`) → 200 und Set-Cookie, `role=admin`; zweiter öffentlicher Sign-up → 403; 10 parallele Erst-Registrierungen → genau ein Nutzer; Admin legt Nutzer B über `create-user` an; `sign-in/email` → 200.
- DoD: Auth-Endpunkte laufen gegen PGlite und Postgres, `requireUser`/`requireAdmin` mit Testroute geprüft (Testroute nur im Test, nicht im Produktcode).

### Task 9: Auth-Seiten (ans Frontend abgegeben; 0a liefert nur die API)
- Bestätigt 2026-11-04: `/login`, `/register`, die geschützte Startseite, `auth-client.ts` und die Seiten-Middleware baut das Frontend (`docs/plans/frontend.md`, Aufgabe 5 und 7) gegen die API aus Task 8. 0a legt unter `app/` nichts an; die Nummer bleibt als Verweis stehen. Pfade sind festgelegt: `/login` (nicht `/sign-in`), `/register`; 0b setzt `loginPage: "/login"`.
- Was 0a dem Frontend zusichert (Vertrag, Prüfung in `auth.test.ts`):
  1. `POST /api/auth/sign-up/email` (`name`, `email`, `password`), `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session` mit `user.role` und `user.banned`.
  2. Gesperrte Registrierung: Status 403 mit Code `REGISTRATION_CLOSED` (Task 8, Schritt 2). Falsches Passwort: 401. Beide Antwortformen werden im Test festgehalten, damit der Mock des Frontends sie nachbauen kann.
  3. Das Frontend darf `createAuthClient` aus `better-auth/vue` ohne `baseURL` verwenden (gleiche Origin); `ALLOWED_ORIGINS` und `BASE_URL` müssen zur Entwicklungs-Origin passen (`.env` aus `pnpm env:init`).
  4. Registrierungsseite: Die Einladung als Token-Link (`/invite/<token>`) kommt erst mit Phase 1; die 0a-Schnittstelle ist dafür offen (O1, `canRegister()`).
- Keine Aufgabe für 0a, kein Browsertest in der 0a-Abnahme.

### Task 10: Integrationstests gegen PGlite
- Zweck: A1, A2, A4, A5, A7, A8, A9 automatisiert (siehe Abschnitt 6).
- Dateien: `tests/vitest.config.ts`, `tests/integration/*`, `package.json` (`test`, `test:int`).
- Schritte:
  1. `harness.ts`: `startServer(env)` startet `node .output/server/index.mjs` als Kindprozess auf freiem Port, wartet auf `/readyz`, liefert `stop()` (SIGTERM, wartet auf Exit). `api()` hält Cookies. Helfer `signUpFirstAdmin()` und `createUser()` (Task 8). Gemeinsam nutzbar für 0b und Phase 1; das Frontend nutzt den Harness für seine Contract- und Echt-Tests nur lesend (`frontend.md` Aufgabe 18), ändert ihn nicht, und die Signaturen sind daher stabil zu halten.
  2. `global-setup.ts`: `TEST_BACKEND` (Default `pglite`): Temp-`DATA_DIR` per `mkdtemp`; Standard-Testwerte für `BASE_URL=http://localhost:<port>`, Secret, `MASTER_KEY` und `RATE_LIMIT=off` (O5, sonst 429 im Build mit `NODE_ENV=production`).
  3. `auth.test.ts`: Registrierung (Rolle `admin`), Login, falsches Passwort → 401, zweite öffentliche Registrierung → 403, parallele Erst-Registrierungen → genau ein Nutzer (A9), Nutzer B über `createUser()`, 20 parallele `get-session`-Aufrufe ohne Fehler (A7). Zusätzlich ein kleiner Test mit `RATE_LIMIT` an (Standard), der bei vielen Sign-ins 429 sieht, damit die Konfiguration nicht still wirkungslos ist.
  4. `startup-race.test.ts`: Server starten, sofort ohne `/readyz`-Warten parallele Anfragen auf eine DB-Route; keine Schemafehler (A8).
  5. `restart.test.ts`: registrieren, stoppen (SIGTERM), mit gleichem `DATA_DIR` starten, Login klappt; Tabelle `drizzle.__drizzle_migrations` hat unverändert 1 Zeile (A4, via Helper `countMigrations()`, bei PGlite direkt über `@electric-sql/pglite` auf gestoppter Instanz).
  6. `startup-checks.test.ts`: ohne `MASTER_KEY`, mit kurzem Secret, mit `http://example.com` → Exit-Code ≠ 0, stderr enthält Variablennamen, nicht den Wert (A5).
- Prüfung: `pnpm build && pnpm test`.
- DoD: alle Tests grün gegen PGlite, Laufzeit < 2 min.

### Task 11: Lauf gegen Postgres-Container
- Zweck: A3 ohne Codeänderung.
- Dateien: `compose.test.yaml`, `tests/integration/global-setup.ts`, `package.json` (`test:pg`).
- Schritte:
  1. `compose.test.yaml`: Service `postgres` (Image `postgres:17`, Tag-Wahl Annahme), Port `54329:5432`, Healthcheck `pg_isready`, tmpfs für Daten.
  2. `global-setup.ts` bei `TEST_BACKEND=postgres`: mit `pg` zum Admin-DB verbinden (`TEST_PG_ADMIN_URL`, Default `postgres://postgres:test@localhost:54329/postgres`), je Testlauf `CREATE DATABASE mcpwarden_<rand>` und danach `DROP DATABASE … WITH (FORCE)`; setzt `DATABASE_URL` für den Server.
  3. `restart.test.ts` ersetzt die Datei-Prüfung der Migrationstabelle durch eine SQL-Abfrage über `DATABASE_URL`; beide Varianten hinter dem Helper `countMigrations()`.
  4. Skript `test:pg`: `docker compose -f compose.test.yaml up -d --wait && TEST_BACKEND=postgres vitest run -c tests/vitest.config.ts; docker compose … down -v`.
- Prüfung: `pnpm test:pg` lokal.
- DoD: derselbe Testsatz ist grün mit `TEST_BACKEND=postgres`; kein `if (backend)` im Produktcode (nur im Testharness).

### Task 12: CI und Entwickler-Doku
- Zweck: beide Backends dauerhaft absichern; Weitergabe an 0b/Phase 1.
- Dateien: `.github/workflows/ci.yml`, `README.md` (Abschnitt "Entwicklung").
- Schritte:
  1. Workflow-Jobs: `check` (install, typecheck, `db:schema && db:generate && db:check`, `git diff --exit-code`, Unit-Tests, Build) und `integration` mit Matrix `backend: [pglite, postgres]`; bei `postgres` als `services: postgres` mit Healthcheck, `TEST_PG_ADMIN_URL` gesetzt. Node-Version aus `.nvmrc`.
  2. Build-Artefakt zwischen Jobs per `actions/upload-artifact` oder pro Matrixjob neu bauen (einfacher, Default: neu bauen).
  3. README-Abschnitt: ENV-Tabelle (sechs Spec-Namen plus Test-Schalter `RATE_LIMIT`), Schema ändern (`db:schema`, `db:generate`, nur sequentiell), Tests lokal (`pnpm test`, `pnpm test:pg`), Hinweis "kein automatisches Deployment", Hinweis auf Single-Instance (Mutex, PGlite), Abschnitt "Zuständigkeiten" (Kurzfassung von 3.2: `app/**` gehört dem Frontend, `server/**` dem Backend, gemeinsame Dateien und `shared/api-types.ts` mit Regeln) und `pnpm env:init` vor dem ersten `dev`/`ui:dev`. Der README-Abschnitt "Frontend" gehört dem Frontend.
- Prüfung: CI-Lauf grün (erst nach Push, der laut Projektregel erst nach Abschluss des ganzen Stacks passiert; bis dahin lokal per Skripten aus Task 10/11).
- DoD: Workflow-Datei vorhanden und lokal syntaktisch geprüft; beide Matrixjobs definiert.

## 4a. Spike-Ergebnisse und Umsetzungsnotizen (2026-11-04, Node 24.13.0, macOS, Nuxt 4.5.2, Nitro 2.13.6, Build `NODE_ENV=production`)

- **Better Auth + PGlite im gebauten Nuxt (U2/R1): grün.** `drizzleAdapter(db, { provider: 'pg' })` mit PGlite läuft im Artefakt; Sign-up, Sign-in, Admin-Endpunkte, 20 parallele `get-session`. Derselbe Testsatz ist grün gegen Postgres 17 (Container).
- **Init-Promise (U4/B1): bestätigt.** `getDb()` löst erst nach der Migration auf; `startup-race.test.ts` (Anfragen unmittelbar nach Prozessstart auf `get-session`, `/healthz`, `/readyz`) sieht nur 200, keinen Schemafehler.
- **Migrationsordner im Build (R3): grün.** Der Nitro-Hook `compiled` (registriert über `hooks['nitro:init']` in `nuxt.config.ts`) kopiert nach `.output/server/migrations`; `resolveMigrationsDir()` probiert Kandidaten relativ zu `import.meta.url` und `<cwd>/server/db/migrations` (Suche nach `meta/_journal.json`).
- **SIGTERM (U8): grün, kein eigener Signal-Handler nötig.** Nitro (`NITRO_SHUTDOWN_SIGNALS`, Standard `SIGTERM SIGINT`) ruft den `close`-Hook; `closeDb()` schließt PGlite, Exit-Code 0, Log `shutdown: db closed` (Test `restart.test.ts`).
- **U3:** Fail-fast läuft über explizites `process.exit(1)` im Plugin (Config synchron, Init im `.catch`); Test `startup-checks.test.ts` bestätigt Exit-Code != 0.
- **U5:** `rateLimit.customRules` mit Pfad `/sign-in/email` und `/sign-up/email` wirkt; `ratelimit.test.ts` sieht 429 bei aktivem Limit (Client-IP im Test per `x-forwarded-for`).
- **U7:** CLI lädt `auth.cli.ts` mit relativen Imports. Wichtig: `database: {} as never` führt zu "Failed to initialize database adapter"; Lösung: `drizzleAdapter({} as never, { provider: 'pg' })`. Die Warnung "Drizzle schema mismatch / Missing tables" beim Generieren ist erwartbar und harmlos. Generierung ist deterministisch (zweimal identisch), `db:generate` danach "nothing to migrate".
- **U9/U10:** Die Sperre hängt in `hooks.before` auf `/sign-up/email`; `auth.api.createUser` (Admin) funktioniert unabhängig davon. `databaseHooks.user.create.before` darf `role: 'admin'` setzen (`{ data: { ...user, role: 'admin' } }`), erster Nutzer ist Admin. Antwortform der Sperre: HTTP 403, Body `{ "message": "Registrierung geschlossen", "code": "REGISTRATION_CLOSED" }` (`AuthErrorBody`).
- **Weitere verifizierte Better-Auth-Optionen:** `emailAndPassword.minPasswordLength: 12` (11 Zeichen: HTTP 400); Endpunkte `update-user`, `change-password`, `list-sessions`, `revoke-session`, `sign-out`, `admin/create-user`, `admin/list-users`, `admin/ban-user` antworten wie erwartet (Namen bestätigt in `auth.test.ts`). Gesperrter Nutzer: Sign-in liefert 403.
- **Nicht geprüft:** SIGKILL-Durability (U6), Doppelstart auf demselben `DATA_DIR`.

Abweichungen vom Plan: (1) `canRegister(ctx, countUsers)` bekommt die Zählfunktion als zweites Argument (Hook-Code bleibt frei von DB-Imports, `auth.cli.ts` lädt ohne generiertes Schema). (2) `buildAuthOptions(deps)` nimmt ein schmales `AuthDeps`-Objekt statt `cfg`. (3) `runMigrations(db, backend)` bekommt das Backend als Argument (kein Importzyklus). (4) `h3@1.15.11` ist direkte Abhängigkeit (pnpm strikt; für `createError` in `session.ts`). (5) `compose.test.yaml` mit `TEST_PG_PORT` (Default 54329), `test:pg` nutzt Compose-Projekt `mcpw-0a`. (6) Zusätzliche Tests: `first-admin-race`, `ratelimit`, `session` (requireUser/requireAdmin in-process, ohne Testroute im Produktcode). (7) `tests/vitest.config.ts` hat zwei Projekte (`unit`, `integration`). (8) `scripts/test-init-env.sh` prüft Modus 600 von `.env`. (9) Tests unter `tests/` sind nicht Teil von `nuxt typecheck`.

## 5. Definition of Done für Phase 0a gesamt

A1 bis A10 erfüllt (A10 früh, mit Task 1), `pnpm test` und `pnpm test:pg` grün, Schema generiert (mit `admin()`) und Migration `0000` eingecheckt, Spike-Ergebnisse aus Task 5/7 (Init-Promise, Migrationskopie, SIGTERM, `provider: 'pg'` im Build) mit Datum und Umgebung im Plan notiert, README-Abschnitt vorhanden, offene Punkte O1 bis O6 vom Nutzer bestätigt oder bewusst vertagt.

## 6. Teststrategie

- **Prinzip:** getestet wird das gebaute Artefakt (`.output/server/index.mjs`) als Kindprozess, nicht der Dev-Server. Damit werden Migrationskopie, Startsequenz, Exit-Codes, Rate-Limit-Verhalten (Produktionsmodus) und echter Neustart mit abgedeckt. `@nuxt/test-utils` wäre laut Peer-Angabe mit Vitest 5 möglich (Review S6), wird aber nicht genutzt: ein Harness für alle Phasen (Review-Entscheidung).
- **Ebenen:** Unit (Config, Master-Key, schnell, kein Build), Integration (HTTP gegen laufenden Server).
- **Backendwahl:** ENV `TEST_BACKEND=pglite|postgres`. Nur `global-setup.ts` und der Helper `countMigrations()` kennen den Unterschied; der Server sieht lediglich, ob `DATABASE_URL` gesetzt ist.
- **Rate-Limit:** Tests setzen `RATE_LIMIT=off`; ein einzelner Test läuft mit aktivem Limit (O5).
- **Zweite Nutzer:** über Admin-API (`createUser()`), nie über öffentliche Registrierung (B3).
- **PGlite lokal/CI:** Temp-`DATA_DIR` je Testlauf, keine externen Dienste. Läuft in jedem Job.
- **Postgres lokal:** `docker compose -f compose.test.yaml up -d --wait`; frische Datenbank je Lauf, Aufräumen per `DROP DATABASE … WITH (FORCE)`.
- **Postgres CI:** `services: postgres` im Matrixjob `postgres`, gleicher Testcode.
- **Nicht in 0a getestet:** SIGKILL-Durability von PGlite (U6), Doppelstart zweier Prozesse auf demselben `DATA_DIR`, Dump/Umstieg PGlite → Postgres (Phase 1, O4).

## 7. Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| R1 `drizzleAdapter` mit PGlite im Nuxt-Build unerwartet inkompatibel (Spike ohne Nuxt war grün) | Auth läuft nur auf Postgres | Spike in Task 5/7 im Build wiederholen; bei Scheitern Stopp und Rückmeldung (Spec-Annahme "Better Auth auf PGlite" wäre widerlegt) |
| R2 Zwei Prozesse auf demselben PGlite-Verzeichnis (z. B. Rolling Restart in Coolify) | Datenbeschädigung | Dokumentieren; optional PID-Lockdatei in `DATA_DIR` (nicht in 0a), Deployment als Recreate statt Rolling |
| R3 Migrationsordner fehlt im Build/Container | App startet nicht | Kopierhook plus Test gegen das Build (Task 7, 10) |
| R4 Generiertes Schema driftet von Migrationen | stille Inkonsistenz | CI-Diff-Check mit `db:check` (Task 12) |
| R5 Node lokal 24.13 < 24.15 | Nuxt-Engine-Warnung/Fehler | `.nvmrc` und `engines`, Hinweis in README |
| R6 Drizzle 1.0 und 0.45 unterscheiden sich (Migrationsformat) | Wechsel später nicht trivial | 0.45.x pinnen, 1.0-Wechsel als eigene Aufgabe nach Release |
| R7 PGlite-Besonderheiten (Single Connection, kein Parallel-Pool) | Deadlock bei langen Transaktionen | ein Client, keine langen Transaktionen, Paralleltest A7 |
| R8 Offene Registrierung vor Phase 1 | Fremde registrieren sich | Default: nach erstem Nutzer gesperrt (Mutex); 0a nicht öffentlich ausrollen |
| R9 Hinter Reverse-Proxy falsche Client-IP für Rate-Limit | Limit wirkungslos oder zu strikt | `ipAddressHeaders`/`trustedProxies` in Phase 1 mit dem Docker-Setup und `TRUST_PROXY` festlegen (nur Header, die der Proxy überschreibt) |
| R10 Vitest 5 sehr neu | Toolchain-Reibung | Fallback Vitest 4 (Better-Auth-Peer erlaubt `^4`); TypeScript bereits auf 5.9.x |
| R11 Nitro wartet Plugins nicht ab (U4 widerlegt) | Request vor Migration | Init-Promise in `getDb()`, `getAuth()` wartet, Race-Test A8; neue Initialisierer immer über `getDb()` absichern, nicht über Plugin-Reihenfolge |
| R12 Mutex gilt nur pro Prozess | Zwei Admins bei mehreren Instanzen | Single-Instance ist Vorgabe (PGlite, R2); bei Postgres-Mehrinstanzbetrieb Sperre per DB (Advisory Lock) nachrüsten |
| R13 PGlite wird bei SIGTERM nicht geschlossen (Nitro ruft `close` nicht) | Datenverlust/Inkonsistenz beim Neustart, A2 rot | Spike U8; Fallback eigener Signal-Handler im Init-Plugin |
| R14 Hook-Verhalten bei `createUser`/Rollenvergabe weicht ab (U9, U10) | Sperre blockiert Admin-API oder erster Nutzer ohne Admin | Spike in Task 8, notfalls Sperre ausschließlich in `hooks.before` und Rolle über `auth.api.setRole` nach dem Anlegen |
| R15 Gemeinsame Dateien (`package.json`, `nuxt.config.ts`, Lockfile, `eslint.config.mjs`) erzeugen Merge-Konflikte zwischen 0a und Frontend | Reibung, verlorene Änderungen | getrennte Blöcke und Schlüssel (3.2), kleine Commits, Frontend zweigt vom Gerüst-Commit ab und rebased regelmäßig; Lockfile-Konflikte durch Neuerzeugen (`pnpm install`) lösen |
| R16 `ui:dev` startet Nitro und `00-init.ts` beendet den Prozess ohne ENV (A5) | Frontend kann im Mock-Modus nicht starten | `pnpm env:init` (Task 1) legt eine lokale `.env` an; Fail-fast bleibt unverändert (3.1) |
| R17 Frontend legt trotzdem Dateien unter `server/` an oder Backend unter `app/` | zwei Quellen, Stilbruch | Eigentumstabelle 3.2, Review prüft Diffs auf Grenzverletzungen |
| R18 Vertrag driftet (Typen ohne Route, Route ohne Typ) | Mock und Echtbetrieb weichen ab | Regeln 3.3, `satisfies` je Route, Contract-Tests des Frontends |

## 8. Schnittstellen für Phase 0b und Phase 1

Stabile Modulnamen und Exporte nach der Abgleichtabelle im Review (Pfade siehe Abschnitt 3; Server-Importe mit `~~/server/...`). `user.id` ist überall `text`.

| Modul | Export | Vertrag |
|---|---|---|
| `server/utils/config.ts` | `getConfig(): AppConfig` | `{ baseUrl: URL, betterAuthSecret, masterKey: Buffer, databaseUrl?: string, dataDir, allowedOrigins: string[], rateLimitEnabled: boolean }`; wirft `ConfigError` mit Variablennamen. Kein `runtimeConfig` (0b E1 entfällt). |
| `server/utils/master-key.ts` | `getMasterKey(): Buffer` | 32 Byte; **keine** Ableitung hier. `deriveUserKey(userId)` (HKDF, P0-4) und `decryptSecret` liegen in Phase 1 unter `server/gateway/crypto/secrets.ts`; `userId` kommt aus dem Auth-Kontext, nie aus der Datenzeile. |
| `server/db/index.ts` | `getDb(): Promise<Db>`, `closeDb()`, `type Db`, `dbBackend` | genau ein Client pro Prozess; das Promise löst **erst nach der Migration** auf; Konsumenten typisieren nur gegen `Db`, kein Backend-Wissen; kein `export db`, kein `client.ts`, kein `casing`-Flag, kein `withTx`. |
| `server/db/schema/index.ts` | alle Tabellen | `auth.ts` generiert; eigene Tabellen (0b/Phase 1) als zusätzliche Dateien, **ohne Tabellenpräfix**, mit `user_id` → `user.id` (text). Die Einstellungstabelle legt 0b an (eine Tabelle für beide Phasen). |
| `server/db/migrate.ts` | `runMigrations(db)` | idempotent; wird nur aus `getDb()` aufgerufen; Migrationen weiter über `db:generate`, nie von Hand. Reihenfolge: 0000 (0a inkl. `admin()`), 0001 (0b OAuth), 0002 (0b eigene), ab 0003 Phase 1. |
| `server/auth/options.ts` | `buildAuthOptions(cfg)` | 0a: `admin()`, Registrierungssperre, Erst-Nutzer-Admin; 0b ergänzt `jwt()`, `mcp()` (`loginPage: "/login"`, Scope `mcp:tools`) und regeneriert Schema (`pnpm db:schema && pnpm db:generate`). |
| `server/auth/index.ts` | `getAuth(): Promise<Auth>` | memoisiert, wartet auf `getDb()`; 0b nutzt es für `/.well-known/*` (an `auth.handler` bzw. Plugin-Helfer durchreichen, B13) und die `/mcp`-Tokenprüfung. |
| `server/utils/session.ts` | `requireUser(event)`, `requireAdmin(event)` | `{ user, session }` (mit `user.role`, `user.banned`) oder 401/403; ein Name für alle Phasen (statt `requireUserSession`). |
| `server/utils/mutex.ts` | `withMutex(fn)` | prozessweit; nutzt 0a für Sign-up, für weitere Einmal-Entscheidungen verwendbar. |
| `server/routes/healthz.get.ts`, `readyz.get.ts` | HTTP | `/healthz` (DB erreichbar), `/readyz` (Migration und Auth bereit); Phase 1 ändert die Dateien (Supervisor-Check). |
| `server/plugins/00-init.ts` | Start | stößt `getDb()`/`getAuth()` an, Fail-fast, Shutdown; wartet nicht (Nitro wartet auch nicht). Phase 1 legt `server/plugins/20-gateway.ts` an, das auf `getDb()` wartet. |
| `app/**` | gehört dem Frontend | 0a liefert nur `app/app.vue` als Platzhalter. `/login` und `/register` baut das Frontend gegen die 0a-API; 0b-Consent, Admin-Layout und alle weiteren Vue-Dateien ebenso (0b liefert nur Routen). |
| `shared/api-types.ts` | Vertrag | 0a: leeres Grundgerüst (Task 1) plus `Role`, `AuthSessionUser`, `ApiErrorBody`, `REGISTRATION_CLOSED` (Task 8); Regeln in 3.3 für alle Phasen. |
| `server/auth/registration.ts` | `canRegister(ctx)` | 0a: nur erster Nutzer; Phase 1: Token-Einladung (`/invite/<token>`, 7 Tage, optional E-Mail-gebunden). Hook und Mutex bleiben. |
| `tests/` | Harness | `startServer`, `api()`, `signUpFirstAdmin()`, `createUser()`, `countMigrations()`; Variablen `TEST_BACKEND`, `TEST_PG_ADMIN_URL`; kein zweites Harness (`test/helpers`, `TEST_DATABASE_URL` entfallen). |

ENV-Namen (fix, aus Spec P0-10): `BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL` (leer = PGlite in `DATA_DIR/pgdata`), `DATA_DIR`, `ALLOWED_ORIGINS` (kommagetrennte Origins, Default = Origin von `BASE_URL`). Zusätzlich in 0a als Test-Schalter `RATE_LIMIT=off` (bestätigt 2026-11-04, O5). `STDIO_MODE` und `TRUST_PROXY` kommen mit Phase 1; Socket-Pfad und Web-UID sind Konstanten im Image. Neue Variablen nur mit Spec-Änderung (Spec v0.4 trägt die Liste nach).

Zuständigkeiten, die 0a **nicht** hat: Audit (`audit_log`, `audit()`) und Logger mit Redaction legt Phase 1 in Meilenstein 1.1 an; `AuthContext` für `/mcp` (mit Feld `role`), `ToolSource`, Origin-Prüfung und Einstellungstabelle gehören 0b; Nutzerverwaltung und `user-lifecycle.ts` Phase 1.

Übergabe-Hinweise:
- Alle: UI-Dateien (`app/**`) liefert nur das Frontend, auch Consent-, Token-, Admin-Seiten; die Backend-Phasen liefern Routen, Tests und Typen in `shared/api-types.ts` (Regeln 3.3).
- 0b: Kernschema ist user/session/account/verification plus `admin()`-Spalten (O3). OAuth-Tabellen (inkl. `oauth_resource`, `oauth_client_resource`) kommen als Migration 0001; `auth.cli.ts` hat bereits eine gültige `baseURL` (B12), `mcp()` schreibt beim Start Resources in die DB und läuft deshalb nur mit `getDb()` aus 0a. `ALLOWED_ORIGINS` speist `trustedOrigins` und die Origin-Prüfung für `/mcp` (P0-1, in 0b). `requireAdmin` und `role`/`banned` sind in 0a vorhanden. Testnutzer B über `createUser()`.
- Phase 1: Signup-Sperre (O1) durch Token-Einladung (`/invite/<token>`, 7 Tage, optional E-Mail-gebunden) in `canRegister()`, Nutzerliste, Sperren (Sessions, OAuth-Refresh-Tokens, PATs) und Löschen ergänzen (Meilenstein 1.1, `user-lifecycle.ts`); Dockerfile muss `.output/server/migrations` mitliefern und `DATA_DIR` für den Nicht-Root-Nutzer beschreibbar machen; Rate-Limit-Proxy-Konfiguration (R9, `TRUST_PROXY`).
- **Umstiegstest PGlite → Postgres (O4, B4):** liegt in Phase 1 (z. B. Aufgabe 1.4.3). Dafür liefert 0a: (a) gleiches Schema und gleiche Migrationen auf beiden Backends ohne Backend-spezifisches SQL, (b) `DATABASE_URL` als einziger Umschalter, (c) `compose.test.yaml`, `TEST_PG_ADMIN_URL` und den Harness mit Backendwahl, (d) sauberes Schließen von PGlite bei SIGTERM, damit der Dump auf einer konsistenten Datei läuft, (e) `drizzle.__drizzle_migrations` bleibt Teil des Dumps. Phase 1 ergänzt `pgDump` → `psql` → Start mit neuer `DATABASE_URL` → Login (inkl. Admin-Rolle) und CI-Job.
