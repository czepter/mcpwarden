# mcpwarden

Development: `pnpm install`, `pnpm env:init`, `pnpm dev`.

Language: repository text (README, docs, code comments, tests, scripts, commit messages) is English; the product UI is German by decision, and so are the user-facing texts it displays (UI copy, error texts shown by the UI, mail subjects and bodies). API values stay English.

Toolchain: Node 24 (`.nvmrc`). Nuxt is pinned to 4.5.2, not 4.6.4: 4.6.x requires Node `^24.15.0`, 4.5.x runs with `^24.11.0` (locally 24.13.0). Raise to 4.6.x once Node >= 24.15 is available (then adjust `engines.node` too).

## Development

Responsibilities: `app/**` belongs to the frontend; `server/**`, `tests/unit|integration`, migrations, `scripts/**` and `ci.yml` belong to the backend. Shared (own keys only, small commits): `package.json`, `nuxt.config.ts`, `eslint.config.mjs`, lockfile. `shared/api-types.ts` is the contract (rules in the header comment, commit prefix `contract:`).

Before the first `dev`, run `pnpm env:init` once (creates `.env` with random values and mode 600, never overwrites).

| Variable | Meaning |
|---|---|
| `BASE_URL` | Public URL, https required except for localhost |
| `BETTER_AUTH_SECRET` | at least 32 characters |
| `MASTER_KEY` | 32 bytes as Base64 or 64 hex characters |
| `DATABASE_URL` | empty = PGlite in `DATA_DIR/pgdata`, otherwise `postgres://…` |
| `DATA_DIR` | data directory, default `./data` |
| `ALLOWED_ORIGINS` | comma-separated origins, default origin of `BASE_URL` |
| `TRUST_PROXY` | optional, default `false`: `X-Forwarded-For` is ignored, the client IP for the rate limits (sign-in, `/oauth2/token`, `/oauth2/register`, invitation info) is the socket address. Behind a reverse proxy set `true` (one proxy hop) or the number of chained proxies (e.g. `2`): the client IP is then the last or N-th entry from the right that the proxy appends; values to the left of it come from the client and never count. Without `true`, all clients behind a proxy share one counter; with `true` and no proxy in front, a client can create its own counters with a forged header: set it only if a proxy that appends the header is really in front. The base URL always comes from `BASE_URL` (never from `X-Forwarded-Host/-Proto`) |
| `SMTP_URL` | optional: `smtps://user:pass@host:465` or `smtp://user:pass@host:587` (STARTTLS required, plaintext only to localhost). Secret, URL-encode |
| `MAIL_FROM` | sender, required when `SMTP_URL` is set, e.g. `mcpwarden <noreply@example.com>` |
| `MAIL_NOTIFY_WINDOW_MIN` | optional: minimum spacing of status mails per upstream and state in minutes (1 to 10080), default `60` |
| `RATE_LIMIT` | tests only: `off` disables the Better Auth rate limit |

Startup aborts with exit code 1 if a required variable is missing or invalid (the message names only names, never values).

Changing the schema: `pnpm db:schema` (regenerate the Better Auth schema), `pnpm db:generate`, `pnpm db:check`. Never edit migrations by hand, schema changes strictly sequential (no parallel migration branches).

Tests: `pnpm build && pnpm test` (unit and integration against PGlite, the built artifact runs as a child process). `pnpm test:pg` additionally starts a Postgres container (`TEST_PG_PORT` overrides port 54329) and runs the same tests with `TEST_BACKEND=postgres`.

Notes: single instance (process-wide mutex for registration, PGlite allows only one process per `DATA_DIR`; deploy as recreate, not rolling). No automatic deployment.

## Does mcpwarden send emails?

Optional. Not without `SMTP_URL`: no mail server is needed, invitations stay links, and all mail features are hidden. With `SMTP_URL` and `MAIL_FROM` (see table) mail sending switches on; built are "Passwort vergessen" (forgot password; link valid for 15 minutes, usable once), invitation mails and status mails. When creating an invitation bound to an address, the admin can tick "Per E-Mail senden" (send by email); the link `/invite/<token>` is then additionally sent to that address and stays visible once in the dialog. If an upstream changes to `open` or `auth_expired` (and once back to healthy), only its owner gets a mail with name, state, a sanitized reason and the link to the upstream page (never secrets, never links from upstream text). Per upstream and state at most one mail per window goes out (`MAIL_NOTIFY_WINDOW_MIN`, default one hour; the counter lives in memory and starts anew after a restart), sending runs in the background through a bounded queue and can never slow down a call. Every user can switch off status mails under Settings > Notifications ("Einstellungen" > "Benachrichtigungen"; default: on). Sending is limited (3 per hour per recipient), a sending error never aborts a request, and neither credentials nor tokens end up in the log. Startup aborts if `SMTP_URL` is invalid or `MAIL_FROM` is missing.

## Connecting a client

The MCP endpoint is `<BASE_URL>/mcp` (POST only, stateless).

OAuth (Claude Code, Cursor): let the client register via Dynamic Client Registration, sign in in the browser and give consent.

```sh
claude mcp add --transport http mcpwarden <BASE_URL>/mcp
```

Then call `/mcp` in Claude Code and complete the login in the browser.

Personal access token: create it under Settings (Tokens); the plaintext is shown only once. According to the Claude Code docs, a set `Authorization` header suppresses OAuth.

```sh
claude mcp add --transport http mcpwarden <BASE_URL>/mcp --header "Authorization: Bearer <pat>"
```

Note: manual acceptance with real clients (Claude Code, Cursor) has not been recorded yet; the automated OAuth PKCE flow test is `tests/integration/oauth/flow.test.ts`.

## Docker and operations

Two targets in the `Dockerfile`: `full` (default) contains the supervisor, `uv`/`uvx` and the stdio workers, `slim` only the web app (stdio fixed off, no capabilities needed).

```sh
pnpm env:init                       # .env with random values, mode 600
docker compose up -d --build        # example compose, target full
curl http://localhost:3000/healthz  # {"ok":true}
```

- `compose.yaml` (target `full`): `cap_drop: [ALL]`, `cap_add: [SETUID, SETGID, CHOWN]`, `no-new-privileges`, `init: true`, `stop_grace_period: 40s`. The supervisor runs as root only to switch UIDs; the web app runs as UID 10001 without capabilities. Without the three capabilities the container starts, stdio is then blocked for non-admins (`no_capabilities`).
- `BASE_URL` must be https (except `localhost`). Reverse proxy: no buffering for `/mcp`, long timeouts (open `subscriptions/listen` streams), append `X-Forwarded-For` (do not overwrite) and set `TRUST_PROXY=true`, otherwise all clients share the proxy's rate-limit counters.
- `/healthz` = process is alive, `/readyz` = migration done and not shutting down (503 `draining`); upstream outages never affect either. `/readyz` also reports `stats_dropped` (measurement records dropped since start).
- Shutdown (SIGTERM): `/readyz` immediately becomes 503, running calls drain for up to 30 s, pool and workers are closed, measurement data is flushed, then exit 0.
- Old volumes: if `/data/pgdata` does not belong to UID 10001, the supervisor aborts and names the one-time `chown` command. `/data` itself must belong to root and must not be group/world-writable.
- The supervisor passes key material (`MASTER_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL`) only to the web app and removes it from its own process env; `/proc/<pid>/environ` of the supervisor still shows the start env (readable by root only). Fully solvable only with Docker secrets/files (not implemented yet).

### Backup and switching from PGlite to Postgres

- Backup (PGlite): stop the app, back up the `data` volume. Postgres: the usual `pg_dump`.
- Switching (app stopped, **same** `MASTER_KEY`, otherwise stored secrets are lost):

```sh
docker run --rm -v mcpwarden_data:/data mcpwarden:full node /opt/tools/pglite-dump.mjs /data > dump.sql
psql -v ON_ERROR_STOP=1 -f dump.sql postgres://user:pass@host/empty_database
# start the app with DATABASE_URL=… and the unchanged MASTER_KEY (no migration run needed)
```

The procedure is verified by `tests/integration/migrate-pglite-to-pg.test.ts` (login, upstreams, tool filter, decryptable secret, running sequences, unchanged migrations table, registration via invitation).

### Security notes

- Invitation links (`/invite/<token>`, 7 days, single use) are secrets: pass them on only to the intended person. The optional email binding is not verified (no mail sending).
- State-changing `/api/**` requests with a session cookie check `Origin` (or `Sec-Fetch-Site`) against `BASE_URL`/`ALLOWED_ORIGINS` and otherwise answer 403 `forbidden_origin`; requests with an `Authorization` header (PAT) are exempt. `/api/auth/**` is checked by Better Auth itself; the Better Auth admin endpoints (`/api/auth/admin/*`) and the OAuth client management (`create-client` etc.) are blocked via HTTP (404).
- Banning permanently revokes the user's sessions, PATs and OAuth consents/tokens; after unbanning, the user must sign in again and create new tokens/connections.
- stdio upstreams: user workers run under their own UID but share network and kernel with the instance; a compromised web app reaches the worker. Approval per user by the admin, default off.
- There is no master key rotation (`upstream_secret.key_version` is reserved for it).
- `ssrf.allow` (admin setting): CIDR or exact hostname. Cloud metadata addresses (169.254.169.254, 100.100.100.200, fd00:ec2::254) are opened only by an explicitly entered single-address entry, never by a hostname or range; link-local only via CIDR/IP.

Tests: `pnpm test:container` (supervisor in the container, Docker required), `pnpm test:compose` (compose smoke against a freshly built image), `pnpm test:slim` (builds and starts the `slim` target without capabilities, checks `/healthz`, `/readyz`, UID 10001 and that stdio is fixed blocked; also runs in CI).

Frontend against real routes: mocks (MSW) exist only in mock builds (`pnpm ui:dev`, `pnpm ui:build`, `VITE_API_MOCK`); `pnpm build` and `pnpm dev` always talk to the real backend (`pnpm ui:check-build` ensures that no mock code is in the build). Contract and full stack:

- `tests/contract/schemas.ts`: strict zod schemas per route. They check the mocks (`pnpm ui:test`) and the real responses of the built server on PGlite or Postgres (`tests/integration/contract.test.ts`, part of `pnpm test` and `pnpm test:pg`).
- `pnpm smoke` (after `pnpm build`): full-stack smoke against a fresh instance (first admin, login, invitation and second user, PAT, OAuth 2.1 with DCR, PKCE S256, consent and refresh, `/mcp` `tools/list` and `tools/call` via a fake MCP, tenant isolation, wrong audience, immediate revocation). As a Vitest suite: `tests/integration/smoke.test.ts`; in the container: `pnpm test:compose`.
- `pnpm ui:e2e`: Playwright against the mocks (`ui:e2e:mock`) and against the real backend without MSW (`ui:e2e:real`). Optional `PW_CHROMIUM_PATH`, `E2E_PORT`, `E2E_REAL_PORT`.


UI against the draft: deviations per page, image pairs (`docs/ui-review/`) and the 11 design decisions (resolved on 2026-11-05) are in [`docs/ui-mockup-review.md`](docs/ui-mockup-review.md); deferred UI items are in [`docs/backlog/ui-deferred.md`](docs/backlog/ui-deferred.md); deliberately omitted items in [`docs/ui-comparison.md`](docs/ui-comparison.md). The structural checks for them are `tests/ui/e2e/mockup-parity.spec.ts` (without pixel snapshots). Not done: manual acceptance with Claude Code and Cursor (see "Connecting a client") and the deferred UI items of the backlog.
