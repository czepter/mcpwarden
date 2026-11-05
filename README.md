# mcpwarden

Entwicklung: `pnpm install`, `pnpm env:init`, `pnpm dev`.

Toolchain: Node 24 (`.nvmrc`). Nuxt ist auf 4.5.2 gepinnt, nicht auf 4.6.4: 4.6.x verlangt Node `^24.15.0`, 4.5.x läuft mit `^24.11.0` (lokal 24.13.0). Anheben auf 4.6.x, sobald Node >= 24.15 verfügbar ist (dann auch `engines.node` anpassen).

## Entwicklung

Zuständigkeiten: `app/**` gehört dem Frontend, `server/**`, `tests/unit|integration`, Migrationen, `scripts/**` und `ci.yml` dem Backend. Gemeinsam (nur eigene Schlüssel, kleine Commits): `package.json`, `nuxt.config.ts`, `eslint.config.mjs`, Lockfile. `shared/api-types.ts` ist der Vertrag (Regeln im Kopfkommentar, Commit-Präfix `contract:`).

Vor dem ersten `dev` einmal `pnpm env:init` (legt `.env` mit Zufallswerten und Modus 600 an, überschreibt nie).

| Variable | Bedeutung |
|---|---|
| `BASE_URL` | Öffentliche URL, https Pflicht außer localhost |
| `BETTER_AUTH_SECRET` | mindestens 32 Zeichen |
| `MASTER_KEY` | 32 Byte als Base64 oder 64 Hex-Zeichen |
| `DATABASE_URL` | leer = PGlite in `DATA_DIR/pgdata`, sonst `postgres://…` |
| `DATA_DIR` | Datenverzeichnis, Default `./data` |
| `ALLOWED_ORIGINS` | kommagetrennte Origins, Default Origin von `BASE_URL` |
| `SMTP_URL` | optional: `smtps://user:pass@host:465` oder `smtp://user:pass@host:587` (STARTTLS Pflicht, Klartext nur an localhost). Geheim, URL-kodieren |
| `MAIL_FROM` | Absender, Pflicht wenn `SMTP_URL` gesetzt ist, z. B. `mcpwarden <noreply@example.com>` |
| `MAIL_NOTIFY_WINDOW_MIN` | optional: Mindestabstand der Statusmails je Upstream und Zustand in Minuten (1 bis 10080), Default `60` |
| `RATE_LIMIT` | nur Tests: `off` schaltet das Better-Auth-Rate-Limit ab |

Der Start bricht mit Exit-Code 1 ab, wenn eine Pflichtvariable fehlt oder ungültig ist (Meldung nennt nur Namen, nie Werte).

Schema ändern: `pnpm db:schema` (Better-Auth-Schema neu generieren), `pnpm db:generate`, `pnpm db:check`. Migrationen nie von Hand editieren, Schemaänderungen strikt sequentiell (keine parallelen Migrations-Branches).

Tests: `pnpm build && pnpm test` (Unit und Integration gegen PGlite, das gebaute Artefakt läuft als Kindprozess). `pnpm test:pg` startet zusätzlich einen Postgres-Container (`TEST_PG_PORT` überschreibt Port 54329) und lässt dieselben Tests mit `TEST_BACKEND=postgres` laufen.

Hinweise: Single-Instance (prozessweiter Mutex für die Registrierung, PGlite erlaubt nur einen Prozess pro `DATA_DIR`; Deployment als Recreate, nicht Rolling). Kein automatisches Deployment.

## Sendet mcpwarden E-Mails?

Optional. Ohne `SMTP_URL` nicht: Es wird kein Mailserver gebraucht, Einladungen bleiben Links, und alle Mailfunktionen sind ausgeblendet. Mit `SMTP_URL` und `MAIL_FROM` (siehe Tabelle) schaltet sich der Mailversand ein; gebaut sind „Passwort vergessen“ (Link 15 Minuten gültig, einmal verwendbar), Einladungsmails und Statusmails. Beim Erzeugen einer an eine Adresse gebundenen Einladung kann der Admin „Per E-Mail senden“ ankreuzen; der Link `/invite/<token>` geht dann zusätzlich an diese Adresse und bleibt im Dialog einmalig sichtbar. Wechselt ein Upstream nach `open` oder `auth_expired` (und einmal zurück nach gesund), bekommt nur sein Besitzer eine Mail mit Name, Zustand, einem bereinigten Grund und dem Link auf die Upstream-Seite (nie Secrets, nie Links aus Upstream-Text). Je Upstream und Zustand geht höchstens eine Mail pro Fenster raus (`MAIL_NOTIFY_WINDOW_MIN`, Default eine Stunde; der Zähler liegt im Speicher und beginnt nach einem Neustart neu), der Versand läuft im Hintergrund über eine begrenzte Warteschlange und kann einen Aufruf nie verlangsamen. Jeder Nutzer kann die Statusmails unter Einstellungen > Benachrichtigungen abschalten (Standard: an). Der Versand ist begrenzt (je Empfänger 3 pro Stunde), ein Fehler beim Versand bricht nie eine Anfrage ab, und weder Zugangsdaten noch Tokens landen im Log. Der Start bricht ab, wenn `SMTP_URL` ungültig ist oder `MAIL_FROM` fehlt.

## Client verbinden

Der MCP-Endpunkt ist `<BASE_URL>/mcp` (nur POST, zustandslos).

OAuth (Claude Code, Cursor): Client per Dynamic Client Registration anlegen lassen, im Browser anmelden und die Zustimmung geben.

```sh
claude mcp add --transport http mcpwarden <BASE_URL>/mcp
```

Danach in Claude Code `/mcp` aufrufen und den Login im Browser abschliessen.

Personal Access Token: unter den Einstellungen (Tokens) erzeugen; der Klartext wird nur einmal angezeigt. Ein gesetzter `Authorization`-Header unterdrueckt laut Claude-Code-Doku OAuth.

```sh
claude mcp add --transport http mcpwarden <BASE_URL>/mcp --header "Authorization: Bearer <pat>"
```

Hinweis: Die manuelle Abnahme mit echten Clients (Claude Code, Cursor) ist noch nicht protokolliert; der automatisierte OAuth-PKCE-Flow-Test ist `tests/integration/oauth/flow.test.ts`.

## Docker und Betrieb

Zwei Ziele im `Dockerfile`: `full` (Standard) enthält den Supervisor, `uv`/`uvx` und die stdio-Worker, `slim` nur die Web-App (stdio fest aus, keine Capabilities nötig).

```sh
pnpm env:init                       # .env mit Zufallswerten, Modus 600
docker compose up -d --build        # Beispiel-Compose, Ziel full
curl http://localhost:3000/healthz  # {"ok":true}
```

- `compose.yaml` (Ziel `full`): `cap_drop: [ALL]`, `cap_add: [SETUID, SETGID, CHOWN]`, `no-new-privileges`, `init: true`, `stop_grace_period: 40s`. Der Supervisor läuft als root nur zum Wechseln der UID; die Web-App läuft als UID 10001 ohne Capabilities. Ohne die drei Capabilities startet der Container, stdio ist dann für Nicht-Admins gesperrt (`no_capabilities`).
- `BASE_URL` muss https sein (außer `localhost`). Reverse-Proxy: für `/mcp` keine Pufferung, lange Timeouts (offene `subscriptions/listen`-Streams), `X-Forwarded-*` setzen.
- `/healthz` = Prozess lebt, `/readyz` = Migration durch und nicht im Herunterfahren (503 `draining`); Upstream-Ausfälle beeinflussen beide nie. `/readyz` meldet auch `stats_dropped` (verworfene Messdatensätze seit Start).
- Herunterfahren (SIGTERM): `/readyz` wird sofort 503, laufende Aufrufe laufen bis zu 30 s aus, Pool und Worker werden geschlossen, Messdaten geflusht, dann Exit 0.
- Altvolumes: Gehört `/data/pgdata` nicht UID 10001, bricht der Supervisor ab und nennt den einmaligen `chown`-Befehl. `/data` selbst muss root gehören und darf nicht gruppen-/welt-beschreibbar sein.
- Schlüsselmaterial (`MASTER_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL`) reicht der Supervisor nur an die Web-App weiter und entfernt es aus dem eigenen Prozess-Env; `/proc/<pid>/environ` des Supervisors zeigt weiter das Start-Env (nur root lesbar). Vollständig lösbar nur mit Docker-Secrets/Dateien (noch nicht umgesetzt).

### Backup und Umstieg PGlite nach Postgres

- Backup (PGlite): App stoppen, Volume `data` sichern. Postgres: übliches `pg_dump`.
- Umstieg (App gestoppt, **gleicher** `MASTER_KEY`, sonst sind gespeicherte Secrets verloren):

```sh
docker run --rm -v mcpwarden_data:/data mcpwarden:full node /opt/tools/pglite-dump.mjs /data > dump.sql
psql -v ON_ERROR_STOP=1 -f dump.sql postgres://user:pass@host/leere_datenbank
# App mit DATABASE_URL=… und unverändertem MASTER_KEY starten (kein Migrationslauf nötig)
```

Der Ablauf ist durch `tests/integration/migrate-pglite-to-pg.test.ts` belegt (Login, Upstreams, Tool-Filter, entschlüsselbares Secret, laufende Sequenzen, unveränderte Migrationstabelle, Registrierung per Einladung).

### Sicherheitshinweise

- Einladungslinks (`/invite/<token>`, 7 Tage, einmalig) sind Geheimnisse: nur an die gemeinte Person weitergeben. Die optionale E-Mail-Bindung wird nicht verifiziert (kein Mailversand).
- stdio-Upstreams: Nutzer-Worker laufen unter eigener UID, teilen aber Netz und Kernel mit der Instanz; eine kompromittierte Web-App erreicht den Worker. Freigabe pro Nutzer durch den Admin, Standard aus.
- Master-Key-Rotation gibt es nicht (`upstream_secret.key_version` ist dafür reserviert).
- `ssrf.allow` (Admin-Einstellung): CIDR oder genauer Hostname. Cloud-Metadatenadressen (169.254.169.254, 100.100.100.200, fd00:ec2::254) öffnet nur ein ausdrücklich eingetragener Einzeladresse-Eintrag, nie ein Hostname oder Bereich; Link-Local nur per CIDR/IP.

Tests: `pnpm test:container` (Supervisor im Container, Docker nötig), `pnpm test:compose` (Compose-Smoke gegen ein frisch gebautes Image).

Frontend gegen echte Routen: Mocks (MSW) gibt es nur in Mock-Builds (`pnpm ui:dev`, `pnpm ui:build`, `VITE_API_MOCK`); `pnpm build` und `pnpm dev` sprechen immer mit dem echten Backend (`pnpm ui:check-build` stellt sicher, dass kein Mock-Code im Build steckt). Vertrag und Full-Stack:

- `tests/contract/schemas.ts`: strikte zod-Schemas je Route. Sie prüfen die Mocks (`pnpm ui:test`) und die echten Antworten des gebauten Servers auf PGlite bzw. Postgres (`tests/integration/contract.test.ts`, Teil von `pnpm test` und `pnpm test:pg`).
- `pnpm smoke` (nach `pnpm build`): Full-Stack-Smoke gegen eine frische Instanz (Erst-Admin, Login, Einladung und zweiter Nutzer, PAT, OAuth 2.1 mit DCR, PKCE S256, Consent und Refresh, `/mcp` `tools/list` und `tools/call` über ein Fake-MCP, Mandantentrennung, falsche Audience, sofortiger Widerruf). Als Vitest-Suite: `tests/integration/smoke.test.ts`; im Container: `pnpm test:compose`.
- `pnpm ui:e2e`: Playwright gegen die Mocks (`ui:e2e:mock`) und gegen das echte Backend ohne MSW (`ui:e2e:real`). Optional `PW_CHROMIUM_PATH`, `E2E_PORT`, `E2E_REAL_PORT`.

