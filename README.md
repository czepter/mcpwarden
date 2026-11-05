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
| `RATE_LIMIT` | nur Tests: `off` schaltet das Better-Auth-Rate-Limit ab |

Der Start bricht mit Exit-Code 1 ab, wenn eine Pflichtvariable fehlt oder ungültig ist (Meldung nennt nur Namen, nie Werte).

Schema ändern: `pnpm db:schema` (Better-Auth-Schema neu generieren), `pnpm db:generate`, `pnpm db:check`. Migrationen nie von Hand editieren, Schemaänderungen strikt sequentiell (keine parallelen Migrations-Branches).

Tests: `pnpm build && pnpm test` (Unit und Integration gegen PGlite, das gebaute Artefakt läuft als Kindprozess). `pnpm test:pg` startet zusätzlich einen Postgres-Container (`TEST_PG_PORT` überschreibt Port 54329) und lässt dieselben Tests mit `TEST_BACKEND=postgres` laufen.

Hinweise: Single-Instance (prozessweiter Mutex für die Registrierung, PGlite erlaubt nur einen Prozess pro `DATA_DIR`; Deployment als Recreate, nicht Rolling). Kein automatisches Deployment.

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
