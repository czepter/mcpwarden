# Phase 1 (core) — implementation plan

As of: 2026-11-04 · Basis: `docs/spec.md` v0.3 (changes for v0.4 in section 2), `docs/ui-comparison.md`, `docs/plans/frontend.md` · Status: revised after `docs/plans/review.md` and the confirmed decisions E13 to E18, draft for approval
Scope per spec: P0-1 to P0-7, P0-9 to P0-11 (gateway, stdio + HTTP upstreams, Bearer/header auth, tool filter, SSRF, Docker, persistence incl. rate limit per upstream and worker per user with supervisor). Tokens/login/consent come as a prerequisite from 0a/0b.
In addition: **P0-4 admin functions** (invitation by token link, ban/delete users, `requireAdmin` routes; finding B2, in milestone 1.1), the **PGlite → Postgres switch test** (P0-11, finding B4, task 1.4.3), minimum parts of P0-14/P0-15 (decision E3) and the read routes `GET /api/dashboard` (without KPIs) and `GET /api/audit` (E16). Not in phase 1: P0-8 REST tools, P0-12 management tools, P0-13 upstream OAuth, routing, profiles, import, poisoning check, statistics and KPIs (phase 2), mail functions, self-deletion.

Language: this document is English; the product UI is German by decision.

**Responsibility (E13):** phase 1 delivers exclusively `server/**`, `supervisor/**`, `tools/**`, tests and contributions to the contract `shared/api-types.ts`. **All Vue files under `app/**` belong to the frontend** (`docs/plans/frontend.md`). Where this plan earlier named pages and components, the API side now stands; which routes the frontend needs per screen is in section 4.5.

## 0. Decisions for the reviewer

Source of the answers: section "Recommendations on the decisions" and reconciliation table in `review.md`. "Adopted" = review recommendation incorporated, no user decision needed. "confirmed 2026-11-04" = decision lies with the user, the plan works with the assumption.

| No | Decision | Answer / state |
|----|--------------|-----------------|
| E1 | SDK line | **v2** (`@modelcontextprotocol/server`/`client` 2.4.0, `@modelcontextprotocol/node` 2.1.2). Adopted. The required options are evidenced in the types (`fetch` on the client transports, `signal`/`timeout`/`maxTotalTimeout` in `RequestOptions`). The spec text "SDK" is adjusted in v0.4. |
| E2 | Sessions / `list_changed` (P0-1 "session ID in the header", P0-5) | **confirmed 2026-11-04:** gateway stateless (spec 2026-07-28, `legacy: 'stateless'`). 2026 clients get `tools/list_changed` via `subscriptions/listen` (task 1.2.8, tenant-separated). 2025 clients: no push, they see changes on the next `tools/list`; security never depends on the push (every `tools/call` checks server-side). Sessionful legacy only if a target client demonstrably needs it. Adjust spec P0-1/P0-5 in v0.4. |
| E3 | Minimum scope P0-14/P0-15 | Adopted, table section 6. Carry the spec phases over in v0.4 (B18). |
| E4 | Where are upstream secrets decrypted? | **Web app.** Adopted. Env secrets for stdio go (depending on E10) directly web app → worker and do not pass the root supervisor. The supervisor knows neither `MASTER_KEY` nor DB. Adjust spec P0-5 in v0.4. |
| E5 | Process structure | **One container**, the supervisor (root, 3 capabilities) starts the web app via `spawn` under an unprivileged UID. Adopted, with the hardening from 4.1 (UID derivation in the supervisor, separate directory trees, no frame parsing in the root process). |
| E6 | `slim` vs `full` | **`slim`**: without supervisor bundle, without `uv`/`uvx`, stdio fixed off (not just a default); the image starts the web app directly as `USER web`. **`full`**: supervisor as entrypoint, `uv`/`uvx`, `STDIO_MODE` default `auto`. Both with Node. Adopted. |
| E7 | Additional ENV variables | Only **`STDIO_MODE`** (`off`\|`auto`) and **`TRUST_PROXY`**; plus the test switch for rate limits that 0a defines (B16). Socket path (`/run/mcpwarden/sup.sock`) and web UID/GID (10001) are constants in the image, not ENV. Adopted. Add the list to spec P0-10 (v0.4). |
| E8 | New tools of an upstream active by default? | Yes. Adopted. Rug-pull protection follows with the poisoning check (P1). |
| E9 | `audit_log` | **Phase 1 creates `audit_log` and `audit()`** (task 1.1.3), since 0b explicitly excludes audit. Adopted. |
| E10 | Data path web app ↔ worker (B8) | **Target:** the supervisor passes the accepted socket connection of the web app per worker as an additional stdio descriptor to the worker; afterwards frames flow directly web app ↔ worker, the root supervisor sees no MCP data. **Fallback** (if spike 1.3.0 fails): the supervisor copies bytes without parsing between socket and worker pipe (raw pipe, no JSON evaluation, no framing in the root process). Spike 1.3.0 decides before 1.3.1 begins. confirmed 2026-11-04 (not an architecture deviation from the review proposal, but affects effort). |
| E11 | Location of the admin functions (B2) | **confirmed 2026-11-04:** `admin()` plugin, "first user = admin", role/`banned` and `requireAdmin` are delivered by 0a; invitation (token link, E14), user list, ban, delete and `user-lifecycle` are delivered by phase 1 as an API, milestone 1.1 (tasks 1.1.9, 1.1.10). The pages are built by the frontend (E13). |
| E12 | stdio idle and child limit (spec question 6) | **confirmed 2026-11-04:** idle 10 min, max. 5 child processes per user (O1). |
| E13 | Responsibility for Vue files (comparison question 1) | **confirmed 2026-11-04:** the frontend takes over all files under `app/**`. Phase 1 delivers routes, data shapes, tests and types in `shared/api-types.ts`. Tasks 1.1.8 to 1.1.10 and 1.3.5 are reduced to the API side; section 4.5 lists the routes per screen and is reconciled with `frontend.md` section 5. |
| E14 | Invitation model (comparison question 2, W8) | **confirmed 2026-11-04:** token link `<BASE_URL>/invite/<token>`, valid 7 days, usable once, optionally bound to an email, revocable. Table `user_invite` with token hash. The pure email allowlist (earlier O5) is dropped; there is no switch "Registrierung per Allowlist". Risk R14 is thereby largely defused (reworded). |
| E15 | Account functions (comparison question 3) | **confirmed 2026-11-04:** self-deletion and mail functions (mail sending, email verification, email change by link, notifications) are dropped. The admin API continues to forbid deleting the own account (1.1.10). No tags and no device names in the data model (comparison question 7). |
| E16 | Dashboard and audit reading in phase 1 (comparison question 4) | **confirmed 2026-11-04:** `GET /api/dashboard` (clients table from `last_used_at`, status, `call_stat`; attention card; **without KPIs**) in task 1.2.9, `GET /api/audit` (reading with filter and pagination) in task 1.1.12. Statistics, KPIs, history, percentile routes stay phase 2. |
| E17 | Audit visibility (comparison question 6) | **confirmed 2026-11-04:** users see only their own entries; the admin additionally sees instance events (user banned/unbanned/deleted, setting changed, invitation, limits). The admin never sees other users' entries. Implementation via `audit_log.scope` (4.2). |
| E18 | Status model, "Aktiv", limits, SSRF list (comparison section 4, W1, W4, W6, W7, W9, W10) | Commissioned by the user 2026-11-04: (a) health enum extended by `unknown` (was already present) and a second axis `setup` with `ready`/`awaiting_auth`/`awaiting_approval` (sections 4.2, 6). (b) "Aktiv" of a client = call within the last 5 minutes (stateless gateway, no session); the API delivers `active` and `lastActiveAt`, never "connected since". (c) `degraded` defined uniformly (section 6); the API delivers `statusReason` as text, no fixed wording in the UI. (d) Limits: 60/min and 5 parallel **per upstream**; user and token limits are own counters and no "limit per client". (e) The SSRF exception is an admin **list** (`ssrf.allow`), not a boolean. |

## 1. Goal and acceptance criteria

Goal: a user enters `https://<host>/mcp` in Claude Code (OAuth or PAT from 0b), creates HTTP and stdio upstreams via the API (the UI for it is built by the frontend on this API), and the gateway passes their tools through namespaced, filtered and limited. An admin invites users by invitation link, bans and deletes them. Afterwards all own clients can be switched over.

Acceptance (all checkable, phase done when green):
1. **End-to-end slice:** Claude Code with **one** entry: `initialize`, `tools/list`, `tools/call` against ≥ 2 HTTP upstreams (Bearer, custom header) and 1 stdio upstream. Result, `isError` and content types text/image/resource arrive unchanged (test with a fake upstream, manual with Claude Code).
2. **Namespacing:** `<slug>__<tool>`, slug (≤ 32 characters) unique per user (DB constraint), a collision of two upstreams with the same tool name resolves correctly.
3. **Isolation:** user B never sees/calls/changes upstreams, tools, secrets, statistics of A (isolation test, 0 hits; also via direct ID accesses of the API). The admin sees only metadata, never secrets/tool contents.
4. **Secrets:** only encrypted in the DB (AES-256-GCM, user-bound key), never in plaintext in API responses, logs, statistics; the app does not start without `MASTER_KEY` (from 0a; checked here).
5. **SSRF:** loopback, link-local, private/documentation networks, metadata IPs, IP literals in all notations, DNS rebinding and redirect to internal targets are blocked, namely **before the connect** (test matrix, section 8, with a real local server); the admin exception list `ssrf.allow` (CIDR or hostname) relaxes exactly the entered targets.
6. **Tool filter:** a change takes effect without restart on `tools/list` and `tools/call` (a disabled tool cannot be called even with a guessed name).
7. **Limits:** rate limit per upstream (default 60/min, 5 parallel) immediately returns a tool error with `retry_after`; global limit per user and per client token; upper bound of upstreams per user (default 50).
8. **Resilience minimum:** timeouts (10 s/15 s/60 s), retry only connect/init/list, breaker opens after 5 consecutive errors, status visible via API (`status`, `setup`, `statusReason`, `nextRetryAt`); a hanging upstream does not block others; abort works correctly per protocol era (HTTP 2026: close stream, legacy/stdio: `notifications/cancelled`).
9. **stdio:** worker per user under its own UID, which the **supervisor itself** derives from the `user_id` (the web app cannot specify a UID), clean env, lazy start, idle end, restart with backoff; separate directory trees (`DATA_DIR` root-owned), no root operation follows symlinks from user-controlled paths; without capabilities stdio is blocked for non-admins and the UI names the reason.
10. **Docker:** `docker compose up` with the example `compose.yaml` starts `full` and `slim`; healthcheck green; smoke test (section 8) green; data survives a restart.
11. **Persistence:** new migrations (from 0003) run on PGlite **and** Postgres (CI against both).
12. **Measurements:** gateway overhead p95 ≤ 50 ms, from the measurement records via `percentile_cont` **and** independently in the load script (client time minus fake upstream time); `tools/list` from cache ≤ 200 ms with 10 upstreams.
13. **Admin functions (P0-4):** registration after the first user only with a valid invitation token (link `/invite/<token>`, 7 days, single use, optionally bound to an email, revocable; token stored only as a hash); the admin bans/unbans/deletes users; a ban takes effect immediately on `/mcp` (OAuth and PAT) and ends pool/worker; deleting removes upstreams, secrets, statistics, worker including directory; the last admin is protected; no deleting of the own account.
14. **Switch PGlite → Postgres (P0-11):** dump via `@electric-sql/pglite-tools`, import into Postgres, start with `DATABASE_URL`: login, upstreams, secrets (decryptable) and migration state are preserved; CI job.
15. **API contract (E13):** every route from section 4.5 is implemented, has request and response types in `shared/api-types.ts` (handlers return `satisfies <type>`), uses the uniform error shape (4.5) and never delivers a secret (leak scan over all responses). Phase 1 contains no Vue file.
16. **Read dashboard and audit (E16, E17):** `GET /api/dashboard` delivers clients (OAuth and PAT, `active` = call within the last 5 min, `lastActiveAt`, `callsPerMin`) and the attention list, without KPIs; `GET /api/audit` filters by category/result/period and paginates by cursor; users see only their own entries, the admin additionally instance events, never foreign user entries (isolation test).

## 2. Assumptions / open points

Assumptions:
- A1: 0a and 0b are finished and satisfy section 3 (the review's reconciliation table is authoritative). Deviations are corrected during reconciliation there or here.
- A2: Target platform Linux container (Docker). macOS dev without UID switch: the supervisor detects this (probe), the web app then runs under its own UID, `canSwitchUser=false`, stdio only for admins.
- A3: Single instance. Pool, catalog cache, rate limits, breaker, stats buffer, `list_changed` handlers live in process memory (spec: technical constraints).
- A4: Node ≥ 24.15 (Nuxt 4.6 engines, 0a); image: Node 24 LTS (image tag **unverified**).
- A5: User IDs are strings (Better Auth default, confirmed by schema generation). All FK columns `user_id text`.
- A6: Tests run as in 0a against the **built artifact as a child process** (`tests/`, `TEST_BACKEND`, `TEST_PG_ADMIN_URL`); pure module tests (secrets, SSRF, limiter, breaker, slug) as unit tests without a build.

Open (non-blocking, with default):
- O1: Idle timeout stdio 10 min, max. 5 child processes per user (E12) as default, changeable via `user_gateway_limits`.
- O2: Maximum length of the total tool name: MCP clients partly limit names (e.g. 64 characters; **unverified**). Slug therefore max. 32 characters, regex `^[a-z0-9][a-z0-9-]{0,31}$` (no `_`, so that `__` separates unambiguously). Already incorporated, do not revert.
- O3: Behavior for upstream tools that do not conform to the spec schema: v2 validates results against the spec schema and rejects deviating ones. Relevant for passing through "1:1", see R3.
- O4: Reverse-proxy headers: `X-Forwarded-Proto` is evaluated only if `TRUST_PROXY=true`; otherwise `BASE_URL` applies.
- O5: Invitation = token link without mail sending (E14): the admin creates the invitation, the API returns the link `<BASE_URL>/invite/<token>` **once**, the admin passes it on themselves. Duration fixed 7 days (constant `INVITE_TTL_DAYS` in `gateway/config.ts`, no parameter). An email binding is optional and checked without verification (the sign-up must use exactly this address, lowercased). Invitees always get the role `user`.
- O6: Handover of the token on sign-up: HTTP header `X-Invite-Token` on the Better Auth request `POST /api/auth/sign-up/email` (proposal; agreed with the frontend, section 4.5). How the `user.create.before` hook reads the header is **unverified** (spike in 1.1.9; fallback `hooks.before` on `/sign-up/email`, which checks the token and passes it to the DB hook via `AsyncLocalStorage`).

Change needs for spec v0.4 (from phase 1, collective list):
- Invitation = token link with expiry 7 days, single use, optionally email-bound, revocable (P0-4); no switch "Registrierung per Allowlist"; self-deletion and mail functions not part of the spec; audit visibility (users: own, admin: additionally instance events); status model `unknown` plus axis `setup` (`ready`/`awaiting_auth`/`awaiting_approval`) next to the health status, `degraded` as the umbrella term "restricted" with trigger (a) consecutive errors from phase 1 and (b) p95 > 3× baseline from phase 2 (section 6); SSRF exception as an admin list.
- SDK name (v2), stateless gateway instead of "session ID in the header", `list_changed` via `subscriptions/listen`, abort over HTTP = close stream (P0-14), decryption in the web app (P0-5), ENV list (E7), P0-14/P0-15 phase assignment, path `DATA_DIR/stdio/<uid>` instead of `<user_id>` (UID assigned by the supervisor, no user ID in paths), `DATA_DIR` root-owned with subdirectory `pgdata` for the web app.

## 3. Expectations of 0a/0b (state after the review's interface reconciliation)

The review's reconciliation table is authoritative. Where 0a/0b have not yet been adjusted, the decisions made there apply. Paths are those of the table.

**Database and schema (0a)**
- `server/db/index.ts`: `getDb(): Promise<Db>`, `closeDb()`, `type Db`, `dbBackend`. Exactly one client per process, no `casing` flag (the generated schema names columns explicitly), no `withTx`. Consumers type only against `Db`.
- Migrations run **inside the memoized `getDb()` promise** (finding B1: Nitro does not await async plugins). Every DB access is thus automatically after the migration. Phase 1 code always calls `await getDb()`, never an own handle.
- `server/db/schema/index.ts` (barrel), `server/db/schema/auth.ts` (generated, do not edit) with `admin()` fields: `user.role` (`admin`\|`user`), `banned`, `ban_reason`, `ban_expires`. `user.id` is `text`.
- Scripts `db:schema`, `db:generate`, `db:check`; folder `server/db/migrations/`. **Numbers:** 0000 (0a, incl. `admin()`), 0001 (0b OAuth), 0002 (0b own tables), **from 0003 phase 1**. Schema changes strictly sequential 0a → 0b → 1 (B23); the CI step `db:check` is mandatory.

**Configuration, session, auth (0a)**
- `server/utils/config.ts`: `getConfig()` with `baseUrl`, `masterKey`, `dataDir`, `allowedOrigins`, `databaseUrl?`. **Phase 1 adds** `stdioMode` (`off`\|`auto`), `trustProxy` (E7) and adjusts `.env.example`.
- `server/utils/master-key.ts`: `getMasterKey()`. The user key derivation is **not** there but in `server/gateway/crypto/secrets.ts` (one file; 0a §8 is adjusted).
- `server/auth/options.ts` (plugins, hooks), `server/auth/index.ts` (`getAuth(): Promise<Auth>`). **Phase 1 adds in `options.ts`** two hooks: registration check by invitation token (task 1.1.9, E14; replaces the lock from 0a O1 on the mutex basis of B3) and lifecycle hooks `user.update.after` (change `banned` → true) and `user.delete.before` → `user-lifecycle` (task 1.1.10), so that the endpoints exposed by the `admin()` plugin itself (`/api/auth/admin/*`) also trigger the lifecycle.
- `server/utils/session.ts`: `requireUser(event) → { user, session }` (401) and `requireAdmin(event)` (403 otherwise); `user.role` and `user.banned` are in the result. Login page `/login`, registration `/register`. Second test users arise in the test harness via `auth.api.createUser` of the admin plugin (B3).
- `server/plugins/00-init.ts` (0a). Phase 1 uses `server/plugins/20-gateway.ts`, which only calls `getDb().then(startJobs).catch(exit(1))`; all gateway parts initialize lazily.
- `server/routes/healthz.get.ts`, `readyz.get.ts` (0a): phase 1 **changes** these files (supervisor check, drain state), does not create them anew.
- UI: all Vue files, layouts, middleware and components lie with the frontend (E13). Phase 1 expects nothing of it and delivers no page; it expects only that the frontend uses the routes from section 4.5 as described there (reconciliation with `frontend.md` sections 3 and 5).
- Read functions from 0b for the dashboard API (1.2.9): `listConnections(userId)` and `listPats(userId)` (name, `lastUsedAt`, for OAuth `allowlisted` and `clientId`, without revoked). Names **unverified**, request from 0b; 0b maintains `last_used_at` on every authenticated `/mcp` request.

**`/mcp`, auth context and seam (0b)**
```ts
// server/auth/auth-context.ts (0b); phase 1 additionally requires the field role
type AuthContext = {
  userId: string
  tokenType: 'oauth' | 'pat'
  tokenId: string                  // for rate limit per token and statistics
  clientId: string | null
  clientName: string | null        // untrusted, truncated
  scopes: string[]                 // 'mcp:tools'; later 'mcpwarden:admin'
  expiresAt: number | null
  resource: string
  role: 'admin' | 'user'           // added by 0b (access-guard reads the user row anyway)
}
```
- Gate order fixed in 0b: origin → method → token → additional check (user banned, client disabled, consent/refresh token present) → MCP handler. The scope is called `mcp:tools`. **The origin/host check lies in 0b** (`server/middleware/origin-check.ts`); phase 1 has no task for it any more.
- **Seam = `ToolSource`** (`server/mcp/upstream-port.ts`, 0b): `listTools(ctx: AuthContext): Promise<ToolDef[]>` and `callTool(ctx, name, args, { signal }: { signal: AbortSignal }): Promise<CallToolResult>`. Phase 1 implements `ToolSource` in `server/gateway/index.ts` (`createGatewayToolSource()`) and thereby replaces the dummy; the SDK server object, `createMcpHandler` and the route stay with 0b. Error contract: unknown/disabled tool = `throw new ToolNotFoundError(name)` (0b maps this to the JSON-RPC error "tool not found", without an existence hint); all other gateway errors arrive as a `CallToolResult` with `isError: true`.
- `signal` is the abort signal of the incoming request (stream closed or `notifications/cancelled` on the legacy path); 0b passes it through.
- **`list_changed`:** 0b exports `notifyToolsChanged(userId)`. The implementation must guarantee tenant isolation (the SDK's `notify` goes to **all** open listen streams of one handler): either one `createMcpHandler` per user or a bus filtered by `userId`. Choice and test in task 1.2.8; the handler split is agreed with 0b. Additionally: open listen streams end at the latest at `ctx.expiresAt` and on `onUserDisabled/Deleted`.
- 0b exports for banning: `revokePatsOfUser(userId)` and `revokeOAuthGrantsOfUser(userId)` (consents, refresh/access token rows); phase 1 calls both in the lifecycle handler, so that a later unban does not revive old PATs/grants.
- Settings table: **one** table `app_setting` (key text pk, value jsonb, updated_at), without prefix, created by 0b; phase 1 uses it with the keys `stdio.enabled` (bool, default `false`) and `ssrf.allow` (list CIDR/hostnames, default `[]`), same dot notation as `oauth.dcr_mode`. No own `instance_setting` table.

**Delivered by phase 1 itself (no prerequisite from 0a/0b)**
- `server/utils/logger.ts` (structured, redaction), `server/utils/audit.ts` + table `audit_log`, `server/utils/user-lifecycle.ts` (handler registry). Task 1.1.3.
- Invitation (token link), user management, ban/delete as an API. Tasks 1.1.9, 1.1.10. Read routes `/api/audit` and `/api/dashboard`. Tasks 1.1.12, 1.2.9. Uniform API error shape `server/utils/api-error.ts` (task 1.1.3).

**Tests (0a harness)**
- Directory `tests/` (`tests/unit`, `tests/integration`, `tests/vitest.config.ts`), harness `startServer(env)`/`stopServer()`/`api()`, `TEST_BACKEND=pglite|postgres`, `TEST_PG_ADMIN_URL`. Phase 1 extends `tests/helpers/` with `createUser({role})` (via `auth.api.createUser`), `createPat(userId)` (0b helper) and a DB query `withDb(fn)` (Postgres at any time, PGlite only with a stopped instance; extension of the 0a helper `countMigrations()`), additionally `tests/fixtures/fake-upstream`. No second harness, no `@nuxt/test-utils`.

## 4. Architecture sketch

### 4.1 Processes

```
Client (Claude Code) --HTTPS--> reverse proxy (TLS) --> [container, target "full"]
  Supervisor (PID≈1 via init, uid 0, caps: SETUID SETGID CHOWN, no_new_privs)
   ├─ spawn(uid=web, gid=web) → web app (Nitro, unprivileged)  ← /mcp, UI, API, DB, MASTER_KEY
   │      │  control socket /run/mcpwarden/sup.sock (file belongs to web UID, 0600)
   │      │   1) control connection: ping, capabilities, ensureWorker, stopWorker, shutdown
   │      │   2) data connection per worker: attach(userId) → the supervisor passes the
   │      │      socket FD on to the worker and does not touch it afterwards
   │      ▼
   └─ worker per user (Node, uid = assigned by the supervisor, clean env, cwd DATA_DIR/stdio/<uid>)
          ▲ data connection directly to the web app (stdio descriptor 3)
          └─ stdio child processes (same uid; npx/uvx/…)
Target "slim": no supervisor, no socket; the entrypoint starts the web app directly as USER web, stdio fixed off.
```

- **Web app:** gateway (`ToolSource`), pool of HTTP clients, catalog, limiter, stats buffer, DB. Holds `MASTER_KEY`, `BETTER_AUTH_SECRET`. Never has capabilities.
- **Supervisor** (`supervisor/`, own small bundle, no DB, no `MASTER_KEY`): starts the web app; commands via the control connection (`ping`, `capabilities`, `ensureWorker`, `attach`, `stopWorker`, `shutdown`); starts workers via `child_process.spawn(process.execPath, [workerJs], { uid, gid, cwd, env, stdio: ['ignore','inherit','inherit', dataSocket] })` and monitors them (backoff restart on demand of the web app, cleanup after exit). It parses **no** MCP frames (E10); the first frame of a data connection (`attach`) is hard-limited to a few hundred bytes.
- **Worker** (`supervisor/worker.ts`): knows no MCP, no SDK. Spawns child processes (command, args, env, cwd come from the web app via the data connection), forwards line-wise JSON-RPC (stdin/stdout of the children) as frames, counts children (limit), enforces limits, creates `home/` and `tmp/` itself (as the user, not as root), ends after idle together with the children. Frames of the other side are limited in size (web app as well as worker).
- **Gateway side stdio:** own `Transport` (`IpcTransport`) that maps `send`/`onmessage` to frames of the data connection; the same MCP `Client` as for HTTP sits on top. Pool and filter are identical for both types. Check the exact `Transport` interface in v2 against the types when building (**unverified**).
- **UID assignment (hardening, B5):** the web app sends only the `userId` (format check `^[A-Za-z0-9_-]{1,64}$`), **never a UID, GID or a path**. The supervisor keeps the mapping `user_id → uid` itself in `DATA_DIR/stdio/.uidmap` (root-owned 0600, written atomically via temp + rename + fsync, sequential assignment from 20000 to 59999, `gid = uid`). UIDs are never reused (not even after deletion). This drops the table `stdio_identity`. The result is never 0, never the web UID. The worker `cwd` is always `DATA_DIR/stdio/<uid>`. Test with forged commands (`uid: 0`, path with `..`, invalid `userId`).
- **Directory trees (hardening, B6):** `DATA_DIR` is root-owned 0755. `DATA_DIR/pgdata` belongs to the web UID (spec path stays). `DATA_DIR/stdio` is root-owned 0711; the web app can create, rename or replace nothing there via symlinks. The supervisor creates `stdio/<uid>` with an exclusive `mkdir` (on `EEXIST`: `lstat` must yield a directory, no symlink, owner root or `uid`, otherwise abort), opens it with `O_DIRECTORY|O_NOFOLLOW` and sets the owner via the descriptor (`fchown`/`FileHandle.chown`; if in doubt `lchown`) and mode 0700. **Afterwards root performs no operation inside `stdio/<uid>` any more** (the user controls the content; otherwise a symlink attack on `chown`). `home/` and `tmp/` are created by the worker as the user. Deleting a user: the supervisor removes the directory via `rm` with no-follow semantics only after all processes of this UID have stopped. No recursive `chown` over web-controlled trees; an existing `pgdata` with the wrong owner leads to a clear error message including a one-time `chown -R` hint in the README (R5).
- **Command auth control socket:** file permissions (web UID only), directory `/run/mcpwarden` root-owned 0755, socket via `CHOWN` to the web UID. Worker UIDs cannot connect. No token needed.
- **Capability probe:** at boot the supervisor starts a throwaway process with a foreign UID (`node -e 0`, uid 65534). Success → `canSwitchUser=true`. No success → mode "without user switch": web app and worker run under their own UID, only admins may use stdio. `STDIO_MODE=off` in target `full`: the supervisor stays entrypoint and lets the web app run under the web UID, but starts neither probe nor worker nor data connections.
- **Groups:** per the libuv source, `spawn` with `uid`/`gid` set first calls `setgroups(0, NULL)` (with `CAP_SETGID`), so supplementary groups of root are not retained. The mandatory test `id -G` stays (task 1.3.4); a `setpriv` fallback and `util-linux` in the image are not planned.
- **Child limits:** `ulimit -u` (processes per UID), `ulimit -v`/`-t` best effort via `sh -c 'ulimit …; exec "$@"'` (**unverified** per image); worker: `--max-old-space-size`. Call run time: timeout in the gateway (default 60 s). cgroup limits only at container level (compose `mem_limit`, `pids_limit`).
- **Residual risk:** a compromised web app can start workers of arbitrary users via `attach` and execute commands in them. This is not covered by the separation (it holds DB and `MASTER_KEY` anyway); what is covered: it reaches neither root nor UID 0 nor its own UID via the supervisor, and foreign paths are not redirected. Record in the README.

### 4.2 Data model (new in phase 1)

All user-related tables with `user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE`; all repository functions take `userId` as the **first** parameter and filter on it (no access by ID alone). Exceptions: `user_invite` (admin only), `audit_log`.

`upstream`
- `id uuid pk default gen_random_uuid()` · `user_id` · `slug text` (regex see O2; **UNIQUE (user_id, slug)**) · `name text` · `description text null`
- `type text` check in (`http`,`stdio`) · `enabled bool default true` · `version int default 1` (every change +1, invalidates pool/catalog)
- HTTP: `url text null`, `transport text default 'auto'` check in (`auto`,`streamable`,`sse`)
- Auth: `auth_type text default 'none'` check in (`none`,`bearer`,`header`,`env`), `auth_header_name text null`
- stdio: `command text null`, `args jsonb default '[]'`, `env jsonb default '{}'` (not secret), `cwd text null` (relative to the user directory, `..` forbidden)
- Limits: `rate_per_min int default 60`, `max_concurrent int default 5`, `timeouts jsonb null` (`{connectMs,listMs,callMs}`)
- Status (written only on change): `status text default 'unknown'` (`unknown`,`healthy`,`degraded`,`open`,`auth_expired`,`disabled`), `status_reason text null` (short explanatory text for the status, e.g. "3 Fehler in Folge, zuletzt Timeout"; source for `statusReason` of the API, never hard-wired in the UI), `status_changed_at`, `last_error text null`, `last_ok_at null`
- Setup (second axis next to the health status, E18): `setup text default 'ready'` check in (`ready`,`awaiting_auth`,`awaiting_approval`). Phase 1 sets `awaiting_auth` as long as `auth_type` ≠ `none` and no secret has been stored yet (state between creation and `secret.put`), afterwards `ready`; `awaiting_approval` is reserved in the enum and set only in phase 2 (stdio drafts created via MCP, P0-12). With `setup` ≠ `ready`, `status` stays `unknown`, the upstream delivers no tools, and `test` answers with the code `awaiting_auth`.
- `created_at`, `updated_at`. Check constraints: HTTP ⇒ `url` set; stdio ⇒ `command` set.

`upstream_secret`
- `id uuid pk` · `user_id` · `upstream_id uuid FK ON DELETE CASCADE` · `kind text` (`bearer`,`header`,`env`) · `name text` (header or env name; for `bearer` `''`) · `ciphertext text` (`v1.<iv>.<ct>.<tag>`, base64url) · `key_version smallint default 1` · `created_at`, `updated_at` · **UNIQUE (upstream_id, kind, name)**.

`upstream_tool` (tool filter + catalog mirror for the UI)
- PK (`upstream_id`, `name`) · `user_id` · `enabled bool default true` · `first_seen_at` · `last_seen_at` · `gone bool default false` (no longer in the upstream, setting is retained).

`user_gateway_limits` (one row per user, defaults merged at runtime)
- `user_id pk` · `max_upstreams int default 50` · `calls_per_min int default 120` · `max_connections int default 20` · `stdio_allowed bool default false` · `stdio_max_procs int default 5` · `stdio_idle_min int default 10` · `updated_at`.
- stdio rule: allowed = instance `stdio.enabled` **and** (`role=admin` **or** `stdio_allowed`) **and** supervisor capability (for non-admins additionally `canSwitchUser`).

`user_invite` (invitation = token link, admin only; task 1.1.9, E14)
- `id uuid pk` · `token_hash text NOT NULL UNIQUE` (SHA-256 over the token; token = 32 random bytes, base64url, 43 characters, is **never** stored and delivered only in the response to creation as a link; a fast hash suffices because of the entropy) · `email text null` (lowercased; set = binding, the sign-up must use this address) · `created_by text null REFERENCES "user"(id) ON DELETE SET NULL` · `created_at` · `expires_at timestamptz NOT NULL` (= `created_at` + 7 days) · `used_at timestamptz null` · `used_by text null REFERENCES "user"(id) ON DELETE SET NULL` · `revoked_at timestamptz null`. State derived: `used` > `revoked` > `expired` > `open`. Single use via a conditional `UPDATE … SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now() AND (email IS NULL OR email = $2) RETURNING id` (atomic, the database decides the race of two registrations). Invitees always get the role `user`. No UNIQUE on `email` (several invitations to the same address are allowed, an older token can be revoked).

`audit_log` (E9; phase 1 creates and reads, E16/E17)
- `id bigserial pk` · `ts` · `user_id text null` (**without FK**, so that entries survive deleting the user; owner or affected user; no email and no name in `meta`) · `actor text` (`user:<id>`, `admin:<id>`, `system`) · `client_id text null` · `action text` · `target_type text` · `target_id text null` · `target_label text null` (slug or name at the time of the entry; for users `null`) · `scope text NOT NULL` check in (`user`,`instance`) · `category text NOT NULL` check in (`management`,`auth`,`status`,`denied`) · `result text NOT NULL default 'success'` check in (`success`,`denied`,`pending`,`status_change`) · `meta jsonb`. `scope`, `category` and `result` are derived by `audit()` from an action table in `utils/audit.ts` (callers pass only `action`) so that they do not drift apart.
- **Visibility (E17):** users read `scope = 'user' AND user_id = <me>`; the admin additionally `scope = 'instance'` (all). Instance events are: user banned/unbanned/deleted, setting changed (`stdio.enabled`, `ssrf.allow`), invitation created/used/revoked, limits or stdio approval of a user changed. User entries are: upstream create/change/delete, secret replaced, status change to `open`/`auth_expired`/return, tool filter changed. There is no way for an admin to read entries of other users with `scope = 'user'`.
- Indexes `(user_id, id)` and `(scope, id)`. Phase 1 writes only `category` `management` and `status` as well as `result` `success` and `status_change`; `auth` (sign-in has no data source, comparison item 30) and `denied`/`pending` (routing and approvals, phases 2 and 3) are foreseen in the schema, the API filters on them but returns empty lists.

`call_stat` (P0-15, write path in phase 1)
- `id bigserial pk` · `ts timestamptz default now()` · `user_id` · `client_id text null` · `token_id text null` · `upstream_id uuid null ON DELETE SET NULL` · `upstream_slug text` · `tool text null` · `kind text` (`list`,`call`) · `status text` (`ok`,`tool_error`,`timeout`,`upstream_error`,`rate_limited`,`breaker_open`,`denied`) · `total_ms int` · `upstream_ms int null` · `overhead_ms int null` · `retries smallint default 0` · `req_bytes int` · `res_bytes int` · `cache_hit bool default false`.
- Index `(user_id, upstream_id, ts)`, index `(ts)` for deletion. Metadata only, never arguments/results.

Deliberately not in the data model (E15): tags, device names, mail addresses for notifications, availability history per upstream (`health-history`, phase 2).

No longer in phase 1: `instance_setting` (replaced by the 0b table `app_setting`, keys see section 3) and `stdio_identity` (UID assignment lies in the supervisor, 4.1).

### 4.3 Encryption of the secrets

- Key derivation per user: `key = HKDF-SHA256(ikm = MASTER_KEY, salt = "mcpwarden/secrets/v1", info = "user:" + userId, len = 32)` via `node:crypto.hkdfSync`. Keys are not stored, only cached briefly in memory (LRU, small size).
- AES-256-GCM, 12-byte random IV, **AAD = `userId|upstreamId|kind|name`** (binds the ciphertext to row and user; a swapped record fails on decryption).
- API: `server/gateway/crypto/secrets.ts` → `encryptSecret(userId, ctx, plaintext)`, `decryptSecret(userId, row)`. **`userId` always comes from the auth context or the session, never from the row**; the repository does not deliver foreign rows anyway. Decryption only in the path "establish connection" (HTTP: set header; stdio: env via the data connection directly to the worker). No endpoint returns plaintext; the UI gets `hasSecret: boolean` and "ersetzen".
- `key_version` reserved for later master key rotation (the mechanism itself not in phase 1, in the README as a known gap).
- Logger redaction covers secret fields; additionally a test that searches logs and API responses for the plaintext.

### 4.4 Request flow `/mcp`
1. 0b: gate (origin → method → token → additional check) delivers `AuthContext`; the MCP handler (0b) calls the phase 1 `ToolSource`.
2. `ToolSource.listTools(ctx)`: catalog from cache for all `enabled` upstreams of the user → filter (`upstream_tool.enabled`) → namespacing. Unreachable upstreams are left out (stale cache preferred), the whole call never fails.
3. `ToolSource.callTool(ctx, name, args, { signal })`: parse the name (first `__`), load the user's upstream via `(userId, slug)`, check "exists, belongs to the user, enabled, tool enabled" (server-side on every call), limiter (user, token, upstream), breaker, pool, forward with abort signal, result returned unchanged, measurement record.
4. Error mapping: gateway-own errors (`rate_limited`, `breaker_open`, `timeout`, `upstream_error`, `denied`) arrive as a `CallToolResult` with `isError: true` and a clear text; an unknown/disabled tool as `ToolNotFoundError` (no hint whether it exists for another user).
5. Changes to the catalog (toggle, upstream on/off/delete, changed upstream tool list) call `notifyToolsChanged(userId)` (task 1.2.8).

### 4.5 API contract for the frontend (routes per screen)

Counts as a contribution to `shared/api-types.ts` (E13): types for each route arise in the same commit as the route, handlers return `satisfies <type>`. Reconciled with `ui-comparison.md` section 5 and `frontend.md` sections 3 and 5; deviations are at the end of this section and are to be carried over there.

**General rules:** JSON, field names camelCase, timestamps ISO-8601, times as `…Ms`. All routes except `GET /api/invites/:token` and the Better Auth routes require `requireUser`, `/api/admin/*` additionally `requireAdmin`. **Error shape** (wish E10 of the frontend plan adopted, helper `utils/api-error.ts`): `{ statusCode, statusMessage, data: { code, message, field? } }`. Codes: `validation` (400/422, with `field`), `not_found` (404, also for foreign records), `forbidden` (403), `slug_taken` and `limit_reached` (409), `slug_immutable` (422), `awaiting_auth`, `stdio_not_allowed` (403, with `data.reason`), `invite_required` and `invite_invalid` (403), `self_target` and `last_admin` (409), `invite_not_open` (409). Responses never contain a secret, only `hasSecret`/`secretNames`. Data structure by domain term; status values English (`healthy` …), the display texts live in the frontend.

| Screen (frontend page) | Route | Request → response | Milestone |
|---|---|---|---|
| Upstream list `/upstreams`, navigation badge | `GET /api/upstreams` | → `{ items: UpstreamSummary[] }`; `UpstreamSummary`: `id, slug, name, description, type, url, command, enabled, status, statusReason, statusChangedAt, lastError, lastOkAt, setup, toolsEnabled, toolsTotal, nextRetryAt, rateLimitHits5m, hasSecret`. `p95Ms` and `recent` (24 bars) are missing in phase 1 and come in phase 2 (optional in the type). `toolsTotal` does not count `gone` tools. | 1.1.8; status fields real from 1.2.5 |
| Create upstream `/upstreams/new` | `POST /api/upstreams` | `{ name, slug, type, description?, url?, transport?, authType?, authHeaderName?, ratePerMin?, maxConcurrent?, timeouts?{connectMs,listMs,callMs}, command?, args?, env?, cwd? }` → 201 `UpstreamDetail`. Slug regex `^[a-z0-9][a-z0-9-]{0,31}$`; 409 `slug_taken` on collision, 409 `limit_reached` from `maxUpstreams`; stdio without permission → 403 `stdio_not_allowed`. A new upstream with `authType` ≠ `none` starts with `setup = awaiting_auth`. | 1.1.8 |
| Create/edit upstream (prefill, block reason) | `GET /api/me/capabilities` | → `{ mcpUrl, role, stdio:{ allowed, reason? }, limits:{ maxUpstreams, upstreamsUsed, maxConnections, callsPerMin }, defaults:{ ratePerMin, maxConcurrent, timeouts } }`. `reason` ∈ `instance_disabled`, `not_granted`, `no_capabilities`, `supervisor_unreachable`, `image_slim` (codes, texts in the frontend). `mcpUrl` = `<BASE_URL>/mcp` (setup command in the empty state of the dashboard). Default values come from the API, not from frontend code. Until 1.3, `stdio.allowed = false` (reason `supervisor_unreachable`). | 1.1.8; complete 1.3.5 |
| Upstream detail `/upstreams/[id]` (overview, auth) and edit `/upstreams/[id]/edit` | `GET /api/upstreams/:id` | → `UpstreamDetail` = `UpstreamSummary` + `transport, authType, authHeaderName, ratePerMin, maxConcurrent, timeouts` (effective values), `args, cwd, env` (non-secret pairs only), `secretNames` (names only), `version, createdAt, updatedAt`. Foreign ID → 404. | 1.1.8 |
| ditto | `PATCH /api/upstreams/:id` | Subset of the create fields plus `enabled` (enable/disable) → `UpstreamDetail`. The slug is immutable (part of the tool names): 422 `slug_immutable`. | 1.1.8 |
| ditto | `DELETE /api/upstreams/:id` | → 204 (deletes secrets, tool rows, closes pool) | 1.1.8 |
| Secret field, "Ersetzen" | `PUT /api/upstreams/:id/secret` | `{ kind:'bearer'\|'header'\|'env', name?, value }` → `{ hasSecret:true, setup }`; `DELETE /api/upstreams/:id/secret?kind=&name=` → 204 (for individual env secrets). Never a response with plaintext. | 1.1.8 |
| "Verbindung testen" (list, detail, after create) | `POST /api/upstreams/:id/test` | → HTTP 200 with `{ ok:true, tools:[{name,description}], latencyMs }` or `{ ok:false, errorCode, message, latencyMs? }`; `errorCode` ∈ `ssrf_blocked`, `redirect`, `timeout`, `connect_failed`, `unauthorized`, `upstream_error`, `protocol`, `awaiting_auth`, `stdio_not_allowed`. Messages sanitized (no internal IP, no secret). Updates the status like a real call. | 1.1.7/1.1.8 |
| Detail, tab "Tools" | `GET /api/upstreams/:id/tools` | → `{ items:[{ name, title, description, enabled, gone, firstSeenAt, lastSeenAt, annotations?{readOnlyHint,destructiveHint,idempotentHint} }], fetchedAt, stale }`. Description and annotations from the catalog cache (empty for `gone`). Errors/p95 per tool only phase 2. | 1.1.7/1.2.2 |
| ditto (switch, takes effect immediately) | `PUT /api/upstreams/:id/tools/:name` | `{ enabled }` → the changed tool object; unknown name → 404 | 1.2.2 |
| Accept page `/invite/[token]` | `GET /api/invites/:token` (public, rate limit per IP) | → `{ valid:true, email, expiresAt }` (`email` = bound address or `null`) or `{ valid:false, reason:'expired'\|'used'\|'revoked'\|'unknown' }` | 1.1.9 |
| Registration `/register`, `/invite/[token]` | `POST /api/auth/sign-up/email` (Better Auth) with header `X-Invite-Token` | first user: without token, role `admin`; otherwise token required, if missing → 403 `invite_required`, invalid/expired/used/wrong email → 403 `invite_invalid` | 1.1.9 |
| Admin: users (invitations) | `GET /api/admin/invites` | → `{ items:[{ id, email, createdAt, expiresAt, status:'open'\|'used'\|'expired'\|'revoked', usedAt, usedByUserId, createdByUserId }] }` (never the token) | 1.1.9 |
| ditto | `POST /api/admin/invites` | `{ email? }` → 201 `{ id, email, createdAt, expiresAt, link }`; `link` = `<BASE_URL>/invite/<token>` **only in this response** | 1.1.9 |
| ditto | `DELETE /api/admin/invites/:id` | revokes an open invitation → 204; otherwise 409 `invite_not_open` | 1.1.9 |
| Admin: users (table) | `GET /api/admin/users` | → `{ items:[{ id, email, name, role, banned, banReason, createdAt, upstreamCount, lastActivityAt, stdioAllowed, limits:{ maxUpstreams, callsPerMin, maxConnections, stdioMaxProcs, stdioIdleMin } }], defaults:{ …same limits fields… } }`. `lastActivityAt` = most recent `call_stat` entry (`null` after 14 days without a call). Metadata only. | 1.1.10 |
| ditto | `POST /api/admin/users/:id/ban` (`{ reason? }`), `POST …/unban`, `DELETE /api/admin/users/:id` | → 204; own account → 409 `self_target`, last active admin → 409 `last_admin` | 1.1.10 |
| ditto (limits dialog, stdio checkbox) | `PUT /api/admin/users/:id/limits` | Subset of `{ maxUpstreams, callsPerMin, maxConnections, stdioAllowed, stdioMaxProcs, stdioIdleMin }` (integers ≥ 1) → user object as in the list; withdrawing `stdioAllowed` stops the worker | 1.1.10 (stdio effect 1.3.5) |
| Admin: instance | `GET`/`PUT /api/admin/settings` | `{ 'stdio.enabled': boolean, 'ssrf.allow': string[] }` (PUT partial) → same shape plus `warnings:[{ key, entry, code:'covers_metadata_ip' }]`. Entries: CIDR (v4/v6) or exact hostname (lowercase, without scheme/port/path/wildcard), max. 100; invalid → 422 with `field: 'ssrf.allow[i]'`. Metadata addresses are **not** forbidden, only reported as a warning (the admin decides). A switch "Registrierung per Allowlist" does not exist (E14). | 1.1.11 |
| Audit `/audit` | `GET /api/audit?category&result&from&to&cursor&limit` | → `{ items:[{ id, ts, actorKind:'user'\|'admin'\|'system', actorIsSelf, clientId, clientName, action, category, scope, targetType, targetId, targetLabel, result }], nextCursor }`. Descending by `id`, `limit` default 50, max. 200, `cursor` = opaque `id`. `clientName` only if resolvable (otherwise `null`). Visibility per E17. Categories `auth`/`denied` return empty lists in phase 1. | 1.1.12 |
| Dashboard `/` | `GET /api/dashboard` | → `{ clients:[{ kind:'oauth'\|'pat', id, name, allowlisted, active, lastActiveAt, callsPerMin, contextTokensEstimate }], attention:[{ upstreamId, slug, name, status, statusReason, nextRetryAt }], attentionCount }`. **No KPIs, no time series** (phase 2). `active` = last call < 5 min, otherwise inactive; `callsPerMin` = `call` records of the last 5 min / 5; `contextTokensEstimate` = size of the most recent `list` record / 4 (estimate, `null` without a record); `allowlisted` only for `oauth`, otherwise `null`. Revocation runs via the 0b routes (`DELETE /api/me/connections/:clientId`, `DELETE /api/me/pats/:id`). `attention` = upstreams with `degraded`, `open`, `auth_expired`. | 1.2.9 |

**Not in phase 1** (the frontend stays in the mock for these screens): statistics and upstream curves (`/api/stats/*`, `/api/upstreams/:id/stats`, `…/health-history`), auth-link pages (`/api/links/*`), stdio approval page (`POST …/approve`), tool mode (`/api/me/preferences`), admin statistics, import/export. The routes for tokens, clients, DCR admin, consent and settings/sessions are delivered by 0a/0b.

**Deviations from or additions to `frontend.md` / `ui-comparison.md` section 5 (to be carried over in the frontend plan):**
- Field names camelCase (`ratePerMin`, `maxConcurrent`) instead of `rate_per_min`/`max_concurrent` of the comparison.
- `GET /api/admin/users` returns `{ items, defaults }` instead of a bare list (default values for the limits dialog, W5).
- `GET /api/me/capabilities` additionally returns `mcpUrl`, `role` and `defaults`; block reasons are codes.
- Invitation: accept route `GET /api/invites/:token` with `reason`; token handover on sign-up as header `X-Invite-Token` (O6, open until spike 1.1.9).
- Upstream object: new `setup`, `statusReason`, `rateLimitHits5m`; `p95Ms`/`recent` only phase 2; `DELETE …/secret` for env secrets; slug immutable.
- Audit entry: `scope`, `category`, `result`, `targetLabel`; no email addresses.
- Dashboard: `contextTokensEstimate` is an estimate (bytes/4), `allowlisted` only for OAuth; no device name.
- `/admin/settings`: only `stdio.enabled` and `ssrf.allow` (no registration switch, no retention values in phase 1).

## 5. Files and paths

```
server/
  db/schema/gateway.ts             # upstream, upstream_secret, upstream_tool, user_gateway_limits, user_invite, call_stat, audit_log
  db/migrations/0003_*.sql ff.     # drizzle-kit generate (names assigned by drizzle-kit)
  gateway/
    index.ts                       # createGatewayToolSource() (replaces the dummy from 0b)
    config.ts                      # timeouts, default limits, constants
    crypto/secrets.ts              # HKDF + AES-GCM (the only crypto file)
    net/ssrf.ts                    # BlockList, assertPublicAddress (literals + resolved addresses)
    net/safe-fetch.ts              # fetch for SDK transports: literal check before connect, undici dispatcher with connect.lookup, redirect:'error', Retry-After capture
    upstream/repo.ts               # all DB accesses, userId-first
    upstream/slug.ts               # validation, namespacing, parser
    upstream/connect.ts            # transport choice, auth header, timeouts, SSE fallback
    upstream/pool.ts               # (userId,upstreamId) → client, single flight, idle close, invalidate
    upstream/catalog.ts            # tools/list cache, upstream list_changed, filter
    upstream/breaker.ts            # states closed/open/half-open
    upstream/limiter.ts            # token bucket + semaphore, user/token/upstream
    upstream/status.ts             # status computation, persistence on change, audit
    proxy/handlers.ts              # listTools/callTool logic behind the ToolSource
    proxy/errors.ts                # error mapping
    proxy/notify.ts                # call notifyToolsChanged(userId), debounced
    stats/buffer.ts                # ring buffer, flush every 5 s/500 entries, stats_dropped
    stats/purge.ts                 # daily deletion of raw data
    stdio/supervisor-client.ts     # control connection + attach to the supervisor
    stdio/ipc-transport.ts         # transport over frames of the data connection
    stdio/policy.ts                # stdio permission (instance, user, capability)
    lifecycle.ts                   # shutdown, registration of the lifecycle handlers
    admin/invites.ts · users.ts    # token invitation (create, hash, claim, revoke), ban/delete orchestration
    dashboard.ts                   # client rows (0b read functions + call_stat), attention list
  utils/logger.ts · audit.ts · user-lifecycle.ts · api-error.ts
  api/upstreams/index.get.ts · index.post.ts
  api/upstreams/[id].get.ts · [id].patch.ts · [id].delete.ts
  api/upstreams/[id]/secret.put.ts · secret.delete.ts · test.post.ts · tools.get.ts · tools/[name].put.ts
  api/me/capabilities.get.ts
  api/invites/[token].get.ts       # public, rate limit per IP
  api/audit/index.get.ts · api/dashboard.get.ts
  api/admin/settings.get.ts · settings.put.ts · users/[id]/limits.put.ts
  api/admin/users/index.get.ts · [id]/ban.post.ts · [id]/unban.post.ts · [id].delete.ts
  api/admin/invites/index.get.ts · index.post.ts · [id].delete.ts
  plugins/20-gateway.ts            # start: jobs (stats flush, purge), shutdown hook; waits for getDb()
  (changed: auth/options.ts (hooks), routes/healthz.get.ts, routes/readyz.get.ts, utils/config.ts)
shared/
  api-types.ts                     # contribution to the contract (types per route from 4.5); owned by the frontend, phase 1 adds in the same commit as the route
# app/** is not delivered by phase 1 (E13); all pages and components belong to the frontend.
supervisor/
  main.ts · protocol.ts · worker.ts · probe.ts · users.ts (uidmap, directories)   # own bundle (esbuild) → dist/supervisor/
tools/
  pglite-dump.ts                   # bundle → dist/tools/pglite-dump.mjs (pgDump via @electric-sql/pglite-tools)
scripts/
  measure-overhead.ts
tests/
  unit/{secrets,ssrf,limiter,breaker,slug,uidmap}.test.ts
  integration/{proxy,isolation,filter,resilience,stats-write,stdio,admin-users,invites,list-changed,audit,dashboard,capabilities,admin-settings,api-contract}.test.ts
  helpers/ (createUser, createPat, withDb)
  fixtures/fake-upstream/{http.ts,stdio.ts}     # controllable fake upstream
  e2e/compose-smoke.sh · e2e/migrate-pglite-to-pg.sh
Dockerfile · compose.yaml · compose.test.yaml · .dockerignore
README.md (sections Docker, proxy streaming, backup/switching, stdio risk)
```

## 6. Minimum parts of P0-14 / P0-15 in phase 1 (decision E3, rationale)

Why in the core: timeouts, error mapping, breaker state and measurement record sit in the same call path as pool and proxy. Retrofitting means rebuilding the path in phase 2 and rewriting all tests. Without timeouts a hanging upstream can hold gateway resources (bulkhead is part of the acceptance "a slow upstream does not block others"). The measurement record is the only way to evidence the success criterion "overhead p95 ≤ 50 ms" in phase 1 (additionally measured from outside, B17).

| Part | Phase 1 | Phase 2 |
|------|---------|---------|
| Timeouts connect 10 s / list 15 s / call 60 s, overridable per upstream | yes (`upstream.timeouts`), implemented via `AbortSignal` plus `timeout`/`maxTotalTimeout` of the SDK `RequestOptions`; stdio connect more generous (60 s, R9) | overridable per tool |
| Abort (timeout or client aborts) | **per era:** Streamable HTTP upstream per spec 2026-07-28: abort = close the response stream; legacy HTTP and stdio: `notifications/cancelled`. Evidenced by a test per variant | – |
| Retry connect/init/list (3×, 500 ms, cap 10 s, jitter) | yes | – |
| Retry `tools/call` | no; **only** session loss at sessionful legacy upstreams (HTTP 404 on session) reinitialize once and retry | idempotent retry (`readOnlyHint`/admin approval) |
| Circuit breaker | consecutive errors (5) → open 30 s, doubling up to 5 min, half-open with one probe call | additionally error rate > 50 % / 30 s |
| Health status | `unknown`/`healthy`/`degraded`/`open`/`auth_expired`/`disabled` passively from real calls and the test button; `auth_expired` on HTTP 401/403 with configured auth. **`degraded`** (uniform with the spec, umbrella term "restricted"): upstream reachable or not permanently disturbed, but the last 1–4 consecutive errors (connection, timeout, 5xx); return to `healthy` on the next success; `isError`, rate limit and `denied` do not count. The reason stands as text in `status_reason` and is delivered as `statusReason`, the frontend hard-codes no condition. Second axis **`setup`**: `ready`/`awaiting_auth`/`awaiting_approval` (4.2). `unknown` = never connected yet or `setup` ≠ `ready`. | active ping every 60 s; additional trigger for `degraded`: p95 > 3× 7-day baseline (same status, different `statusReason`) |
| Definition "Aktiv" (clients) | The gateway is stateless: a client is **active** if its last call (`last_used_at`/`call_stat`) was less than 5 min ago (constant `ACTIVE_WINDOW_MS`), otherwise inactive. No "connected since", no session (E18). | – |
| Tools of an `open` upstream | stay visible, return errors | hiding configurable |
| `/healthz`, `/readyz` | yes (the Docker healthcheck needs it; change of the 0a files) | – |
| Bulkhead | concurrency limit per upstream (semaphore), separate clients per upstream | – |
| Graceful shutdown | yes (SIGTERM, 30 s drain, end workers) | – |
| `tools/list_changed` | yes, for 2026 clients via `subscriptions/listen`, tenant-separated (1.2.8) | push for legacy only on evidence |
| Measurement record `call_stat` | write path with buffer, `stats_dropped`, 14-day deletion, only `list`/`call` | management/routing kinds |
| Percentiles, rollups/histograms, retention 13 months | no (raw data suffices; the test computes `percentile_cont` itself) | yes |
| Statistics page, `get_stats`, admin aggregates | no | yes |
| Status change → audit | yes (cheap, useful for troubleshooting) | notification (P1) |

## 7. Tasks per milestone

Order: 1.1 → 1.2 → 1.3 → 1.4. 1.3 depends on 1.2 (proxy path), 1.4 can begin from 1.2 with `slim`; the spike 1.3.0 can already run during 1.2. Within 1.1, 1.1.9/1.1.10 (admin), 1.1.11 (settings) and 1.1.12 (read audit) are independent of 1.1.4–1.1.8 after 1.1.3 and possible in parallel; 1.1.11 must precede the allowlist case of the SSRF matrix (1.1.5) or the test sets `ssrf.allow` directly in `app_setting`. 1.2.9 (dashboard API) needs 1.2.5 (status) and 1.2.6 (`call_stat`). All routes contribute their types to `shared/api-types.ts` (section 4.5); Vue files do not arise here (E13). Each milestone is individually acceptable. The isolation test starts in 1.1 and is extended per milestone. Migrations arise strictly after the last one of 0b (from 0003); for each task with a schema change: `db:schema`/`db:generate`/`db:check`.

### Milestone 1.1 — Upstream management HTTP (persistence, crypto, SSRF, API) and admin functions (P0-4)
Acceptance: via the API (routes from 4.5, the frontend builds the pages) a user creates an HTTP upstream (none/Bearer/header), replaces the secret, tests the connection and receives the tool list or a concrete error message; foreign users see nothing; SSRF matrix green. The admin creates invitation links with which users can register; the admin bans/unbans/deletes users with effect on tokens and data; the admin maintains `stdio.enabled` and `ssrf.allow`; `GET /api/audit` returns the visible entries.

**1.1.1 Fix the SDK choice and dependencies**
- Purpose: implement E1, basis for all further tasks.
- Files: `package.json`, `server/gateway/config.ts`.
- Steps: reconcile with the state of 0b (v2 is set there). Install: `@modelcontextprotocol/client`, `@modelcontextprotocol/server`, `@modelcontextprotocol/node` (version state at planning: 2.4.0 / 2.4.0 / 2.1.2), `zod@^4.2`, `undici` (npm package for dispatcher and matching `fetch`, see R16), `@electric-sql/pglite-tools` (dev, for 1.4.3). Short trial run: client against fake upstream `connect` + `listTools`.
- Check: typecheck, trial run green. DoD: versions pinned exactly, deviation from 0b documented.

**1.1.2 Schema and migration**
- Purpose: tables from 4.2.
- Files: `server/db/schema/gateway.ts`, migration(s) from 0003.
- Steps: create tables/constraints/indexes (foreign keys to `user.id` from the generated auth schema); generate the migration with drizzle-kit and check it in; portable SQL only (no PGlite special case). `gen_random_uuid()` is Postgres core since 13, PGlite is based on Postgres 17: the migration test covers it, no special solution.
- Check: migration runs on PGlite and Postgres (`TEST_BACKEND`), idempotent twice; FK cascade test (delete user → upstreams/secrets/statistics gone, `audit_log` stays). DoD: CI matrix of both backends green for this test.

**1.1.3 Logger, audit, lifecycle registry**
- Purpose: cross-cutting parts that 0a/0b do not deliver (E9).
- Files: `server/utils/logger.ts`, `audit.ts`, `user-lifecycle.ts`, `api-error.ts`.
- Steps: `logger` structured with redaction (`authorization`, `secret`, `token`, `password`, `cookie`, `x-invite-token`; paths `/invite/<token>` and `/api/invites/<token>` are masked in access logs). `audit({ userId, actor, clientId?, action, targetType, targetId?, targetLabel?, meta? })` writes to `audit_log`; `scope`, `category` and `result` come from the action table in `audit.ts` (4.2), not from the caller (write errors are logged, do not break the action). `api-error.ts`: `apiError(status, code, message, field?)` creates the uniform error shape from 4.5 (h3 `createError`). `user-lifecycle.ts`: `registerLifecycleHandler({ onUserDisabled, onUserDeleted })`, `runUserDisabled(userId)`, `runUserDeleted(userId)` (handlers run sequentially, errors of one handler are logged and do not stop the others).
- Check: unit tests redaction and handler order. DoD: green.

**1.1.4 Secret encryption**
- Purpose: P0-6, user-bound key.
- Files: `server/gateway/crypto/secrets.ts`, `tests/unit/secrets.test.ts`.
- Steps: HKDF derivation, AES-GCM with AAD, format `v1.<iv>.<ct>.<tag>`; error on manipulation; small key cache; `userId` exclusively as a parameter from the context (4.3).
- Check: round trip; decrypting with the key of user B fails; swapped row (other `upstreamId`) fails; ciphertext does not contain the plaintext; fixed test vector. DoD: tests green, no plaintext return in any API.

**1.1.5 SSRF protection**
- Purpose: P0-9 for HTTP upstreams, checked **before** the connect.
- Files: `server/gateway/net/ssrf.ts`, `net/safe-fetch.ts`, `tests/unit/ssrf.test.ts`.
- Steps:
  - `node:net.BlockList` with blocked networks. IPv4: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0.0/24`, **`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`** (documentation networks), `192.168/16`, `198.18/15`, `224/4`, `240/4`. IPv6: `::1`, `::`, `fc00::/7`, `fe80::/10`, `ff00::/8`, **`2001:db8::/32`**; check IPv4-mapped `::ffff:0:0/96`, NAT64 `64:ff9b::/96` and **6to4 `2002::/16`** for the embedded v4 address and test it against the v4 list.
  - **Two check points, both mandatory:** (1) `assertPublicAddress(host)` in `safe-fetch` **before every request** for hosts that are IP literals (after WHATWG URL normalization, which already resolves decimal, hex and octal notations; strip IPv6 brackets). For literals no DNS lookup runs, `connect.lookup` alone would not catch them. (2) For hostnames the undici dispatcher validates every resolved address with its own `connect.lookup` (closes the rebinding gap between check and connection; a private hit among several records rejects). Additionally a check when saving/testing as early feedback (convenience only, never protection).
  - Only `http:`/`https:`, no userinfo in the URL.
  - `safe-fetch` delivers a `fetch` function (type `FetchLike`) that is passed to **all** SDK client transports (`StreamableHTTPClientTransport`, `SSEClientTransport`) (option `fetch` is evidenced in the v2 types). `redirect: 'error'`: redirects are not followed; the error message says "Upstream leitet um, bitte Ziel-URL direkt eintragen". Manual following with revalidation is deliberately not part of phase 1.
  - The admin exception list (`app_setting` `ssrf.allow`, list of CIDR or exact hostname, E18; no boolean) is read fresh on every call (short cache ≤ 10 s). A CIDR entry allows addresses in this network for every hostname, a hostname entry allows exactly this name together with its resolved addresses. The list is maintained by `PUT /api/admin/settings` (1.1.11). The wrapper captures `Retry-After` of the response for the limiter module.
- Check: test matrix section 8, **including integration with a real local server** that demonstrably receives no connection. DoD: all matrix cases green; case "exception list `ssrf.allow`" green (CIDR and hostname); test that a transport without `safe-fetch` is built nowhere (code search/lint rule on direct transport construction outside `connect.ts`).

**1.1.6 Upstream repository and validation**
- Purpose: user-bound access, slug rules, limits.
- Files: `server/gateway/upstream/repo.ts`, `slug.ts`, `tests/unit/slug.test.ts`.
- Steps: functions `list/get/create/update/delete(userId, …)`; slug regex and automatic proposal from the name; cap `max_upstreams` on creation (409); increment `version` on change; HTTP URL syntax check (scheme, host) in addition to the runtime SSRF check; stdio fields in 1.1 only validate, do not yet execute: the API rejects creating/enabling/testing a stdio upstream until the policy from 1.3.5 with 403 `stdio_not_allowed` (policy stub, `reason` = `supervisor_unreachable`).
- Check: unit tests slug (reserved names, `__`, length 32), limit 50, cross-user access returns `null`. DoD: no repo call without `userId`.

**1.1.7 Connection setup, test, tool catalog (HTTP)**
- Purpose: "test connection", basis for pool/proxy.
- Files: `upstream/connect.ts`, `upstream/catalog.ts` (only `fetchTools`), `api/upstreams/[id]/test.post.ts`, `api/upstreams/[id]/tools.get.ts`.
- Steps: transport choice `auto`: first Streamable HTTP, on connection error/4xx behavior without Streamable support fall back to SSE with a fresh client (docs pattern "new client for the fallback"); remember the detected kind in `transport`. Auth: `bearer` → `Authorization: Bearer …`, `header` → named header, secrets freshly decrypted. All transports with `fetch: safeFetch`. Connection setup with `AbortSignal.timeout(10_000)`, `listTools` with 15 s (`signal` and `timeout` of the `RequestOptions`). The test endpoint returns `{ok, tools:[{name,description}], latencyMs}` or `{ok:false, errorCode, message}` with a sanitized message (no secret, no internal IPs from SSRF hits: message "Ziel nicht erlaubt (SSRF-Schutz)").
- Check: fake upstream (Streamable-only, SSE-only, 401, hangs, 500, redirect). DoD: each variant returns the expected message; wrong token → message "401 vom Upstream".

**1.1.8 REST API upstreams (server only, E13)**
- Purpose: CRUD, replace/delete secret, test, status fields, `capabilities`, as the contract for the frontend pages `/upstreams`, `/upstreams/new`, `/upstreams/[id]`, `/upstreams/[id]/edit`.
- Files: `api/upstreams/*` (list, create, detail, change, delete, `secret.put`/`secret.delete`, `test`), `api/me/capabilities.get.ts`, types in `shared/api-types.ts`. No Vue files.
- Steps: routes and data shapes exactly per 4.5 (`UpstreamSummary`, `UpstreamDetail`, `setup`, `statusReason`, `rateLimitHits5m`, `secretNames`); `requireUser`; responses without secret, with `hasSecret`; `secret.put` encrypts, increments `version` and sets `setup` to `ready`; `PATCH` with `enabled`, slug immutable (422); deleting closes the pool and removes tool rows; `capabilities` with `mcpUrl`, `limits`, `defaults` and (until 1.3.5) fixed block `supervisor_unreachable`; uniform error shape (`api-error.ts`); audit entries (created/changed/deleted, secret replaced). Status fields are `unknown`/`null`/`0` until 1.2.5, but the shape is fixed from here on.
- Check: API tests (validation per field incl. slug regex, `slug_taken`, `limit_reached`, `slug_immutable`, `awaiting_auth` on a missing secret, foreign ID → 404), response leak scan, type check against `shared/api-types.ts`. DoD: isolation test (section 8) for all new endpoints green; the secret appears in no response/log; the routes are reconciled in 4.5 and in the frontend plan. The goal "≤ 2 min from empty form to test green" is checked by the frontend (frontend.md task 10) against this API.

**1.1.9 Admin: invitation by token link and registration (P0-4, E14)**
- Purpose: registration after the first user only with a valid invitation token; replaces the blanket lock from 0a O1. API only (E13); the pages `/invite/[token]` and the invitation area in `/admin/users` are built by the frontend.
- Files: `server/gateway/admin/invites.ts`, `server/auth/options.ts` (hook, changed), `api/admin/invites/*`, `api/invites/[token].get.ts`, schema `user_invite`, types in `shared/api-types.ts`.
- Steps: `POST /api/admin/invites` (`{ email? }`) generates 32 random bytes, stores only the SHA-256 hash, sets `expires_at` = now + 7 days and returns `link` (`<BASE_URL>/invite/<token>`) **once**; `GET` lists with derived `status` without token; `DELETE` revokes open invitations (`revoked_at`). The public `GET /api/invites/:token` (hash lookup, rate limit per IP, no distinction except the `reason` for the token holder) returns `{ valid, email, expiresAt }` or `{ valid:false, reason }`. Sign-up: the token arrives as header `X-Invite-Token` (O6). `databaseHooks.user.create.before`: first user → allowed, role `admin` (0a); otherwise if the token is missing → 403 `invite_required`; the token is claimed via the atomic `UPDATE … RETURNING` (4.2), if that fails (unknown, used, revoked, expired, email does not match the binding) → 403 `invite_invalid`; `after`: set `used_by`, audit. If creating the user fails after the claim (e.g. email already taken), the invitation is consumed and the admin creates a new one; whether Better Auth does the duplicate check before the hook (then this hardly occurs) is **unverified** and recorded in the test. The sign-up serialization via mutex (0a, B3) stays the basis. Audit (created/used/revoked, scope `instance`). All admin routes with `requireAdmin`. Spike at the beginning: header access in the hook or fallback `hooks.before` + `AsyncLocalStorage` (O6).
- Check: test: without token 403 `invite_required`, with token ok, second registration with the same token 403 `invite_invalid`, expired token (time manipulated) 403, revoked token 403, email-bound token with another address 403 and with the same address in a different spelling ok, two parallel registrations on the same token → exactly one ok, the token appears neither in lists, logs nor audit (leak scan), `GET /api/invites/:token` reports `reason` correctly; a non-admin gets 403 on the admin API. DoD: green; note on R14 (new) in the README.

**1.1.10 Admin: user list, ban, delete, limits (P0-4)**
- Purpose: manage users; ban/delete take effect on tokens, pool and worker. API only (E13); table, dialogs and the `requireAdmin` page guidance are built by the frontend.
- Files: `api/admin/users/*` (incl. `[id]/limits.put.ts`), `server/gateway/admin/users.ts`, `server/auth/options.ts` (lifecycle hooks), `lifecycle.ts`, types in `shared/api-types.ts`.
- Steps: list per 4.5 with `id`, email, name, role, `banned`, `banReason`, creation date, `upstreamCount`, `lastActivityAt` (most recent `call_stat` entry, `null` after 14 days), `stdioAllowed`, `limits` and `defaults` (metadata only, never upstream contents). `PUT …/limits` sets the row in `user_gateway_limits` (subset, integers ≥ 1, audit scope `instance`). **Ban:** Better Auth `banUser` (ends sessions) → lifecycle `onUserDisabled`: phase 1 handlers close the user's pool, end the worker, discard limiter/catalog/listen handler, call `revokePatsOfUser` and `revokeOAuthGrantsOfUser` (0b). Unban: `unbanUser`; PATs and grants stay revoked (the user creates new ones). **Delete:** `onUserDeleted` handlers first (pool, worker including `purge` of the user directory via the supervisor), then removal of the user; FK `CASCADE` clears upstreams, secrets, tool rows, limits, `call_stat`. The hooks sit in the Better Auth `databaseHooks` (`user.update.after` on change `banned` → true, `user.delete.before`), so that the endpoints exposed by the `admin()` plugin (`/api/auth/admin/*`) also trigger the lifecycle. Protection rules: no banning/deleting of the own account via this API (409 `self_target`; a self-deletion does not exist, E15), the last active admin cannot be banned or deleted (409 `last_admin`). Audit (without email in `meta`, scope `instance`).
- Check: test with user A (upstream, PAT, OAuth token, open pool connection): admin bans A → next `/mcp` request with PAT and OAuth token 401, pool counter 0, after unban the PAT stays invalid; delete → upstream rows gone, audit entry stays; calling `/api/auth/admin/ban-user` directly triggers the same lifecycle; the last admin cannot be deleted; non-admin 403. DoD: green; acceptance 13 evidenced (worker part added in 1.3).

**1.1.11 Admin settings (API)**
- Purpose: make `stdio.enabled` and the SSRF exception list `ssrf.allow` maintainable (E18); prerequisite for the allowlist case of the SSRF matrix.
- Files: `api/admin/settings.get.ts`, `settings.put.ts`, types in `shared/api-types.ts`.
- Steps: read/write the `app_setting` keys (section 3) with `requireAdmin`; PUT takes a subset; validation of `ssrf.allow` (CIDR v4/v6 or exact hostname, lowercase, without scheme/port/path/wildcard, max. 100 entries, otherwise 422 with `field: 'ssrf.allow[i]'`); warning `covers_metadata_ip` in the response if an entry covers metadata addresses (no prohibition); the cache of the SSRF list is invalidated; audit "setting changed" (scope `instance`, `meta` with key and count, never with values that reveal internal topology). `stdio.enabled` takes effect from 1.3.5; until then it is only stored. No switches for registration or retention (E14, phase 2).
- Check: API tests (admin ok, user 403, validation, warning, effect on `safe-fetch` in the SSRF matrix). DoD: green.

**1.1.12 Read audit (API, E16, E17)**
- Purpose: `GET /api/audit` for the audit page and the management trail; the write path exists since 1.1.3.
- Files: `api/audit/index.get.ts`, read function in `utils/audit.ts`, types in `shared/api-types.ts`.
- Steps: filters `category`, `result`, `from`, `to`; cursor pagination over `id` descending (`limit` default 50, max. 200, invalid values → 422); visibility from 4.2 enforced server-side (`scope = 'user' AND user_id = me` or additionally `scope = 'instance'` for the admin); fields per 4.5 (`actorKind`, `actorIsSelf`, `targetLabel`; `clientName` best effort via the 0b client list, otherwise `null`; for user targets `targetLabel` from the still existing user row, otherwise `null`); never output email addresses or `meta` contents with secrets (`meta` is not delivered in phase 1).
- Check: integration test `tests/integration/audit.test.ts`: A sees own upstream entries, B does not; the admin sees instance events (ban, setting, invitation) but not A's upstream entries; a user sees no instance events; pagination without gaps/duplicates on concurrent inserts; filters; entries of a deleted user stay visible to the admin as an instance event. DoD: green; acceptance 16 (audit part).

### Milestone 1.2 — Tool filter + proxy path (+ limits, resilience minimum, stats write path, list_changed, dashboard API)
Acceptance: Claude Code (or a test client) sees and calls the tools of all active HTTP upstreams via `/mcp`; filter, limits, timeouts, breaker, statistics records work; `list_changed` reaches only the right user; overhead measurement is available; `GET /api/dashboard` returns clients and attention list from real data.

**1.2.1 Pool**
- Purpose: one pooled client session per (user, upstream), lazy.
- Files: `upstream/pool.ts`, `lifecycle.ts`.
- Steps: map `userId:upstreamId` → `{client, version, lastUsed, inflight}`; single flight on connecting; a new `version` in the upstream → close the old client (HTTP: `terminateSession()` only if the upstream assigned a session, then `close()`); idle close after 5 min; cap `max_connections` per user (oldest idle is evicted, otherwise error); `onUserDisabled/Deleted` closes everything; upstream notification `tools/list_changed` invalidates the catalog.
- Check: integration test with a fake upstream: second call uses the same connection; a change to the upstream creates a new one; banning the user closes the connection. DoD: no connection leak (test counter of open sockets after the test = 0).

**1.2.2 Catalog, namespacing, filter**
- Purpose: P0-1 names, P0-7 filter.
- Files: `upstream/catalog.ts`, `upstream/slug.ts`, `api/upstreams/[id]/tools/[name].put.ts`, `api/upstreams/[id]/tools.get.ts` (shape per 4.5, incl. `annotations`, `stale`).
- Steps: catalog cached per upstream (TTL 10 min, invalidation by `version`, `list_changed`, toggle); on fetch upsert `upstream_tool` (`first_seen_at`, `last_seen_at`, `gone`); aggregation in parallel with a 15 s deadline per upstream, on error stale cache or leave out; namespacing `<slug>__<tool>`; pass input schema, annotations, `title` through unchanged; the toggle API switches `enabled`, invalidates and calls `notifyToolsChanged` (1.2.8); audit (tool filter changed, scope `user`).
- Check: two upstreams with the same tool name → two entries; the toggle takes effect without restart in the next `tools/list`; measurement `tools/list` from cache with 10 fake upstreams ≤ 200 ms. DoD: green.

**1.2.3 ToolSource: `listTools`/`callTool`**
- Purpose: P0-1 core behind the seam of 0b.
- Files: `gateway/index.ts`, `proxy/handlers.ts`, `proxy/errors.ts`.
- Steps: `createGatewayToolSource()` implements `ToolSource` (section 3); the dummy from 0b is replaced, the route and the MCP handler stay unchanged. `callTool`: parse name → upstream via `(userId, slug)` → checks → pool → `callTool` of the client with a deadline (60 s, upstream override; `signal = AbortSignal.any([ctx signal from 0b, AbortSignal.timeout(ms)])`, plus `timeout`/`maxTotalTimeout` of the `RequestOptions`; clarify the behavior with progress notifications in the test). The result is returned **unchanged** (`content`, `structuredContent`, `isError`, `_meta`). Unknown/disabled → `ToolNotFoundError` without existence hint. A disabled upstream (`enabled=false`) → its tools are missing from the list and calls are rejected.
- Check: the fake upstream returns text, image, resource, `isError`, `structuredContent`; gateway output identical (deep equal except names in `tools/list`). A call with a guessed name of a foreign user → same error as non-existent. DoD: green; Claude Code manual test (acceptance 1).

**1.2.4 Limiter (rate limit per upstream, global per user/token)**
- Purpose: P0-5 rate limit, P0-4 caps.
- Files: `upstream/limiter.ts`, `tests/unit/limiter.test.ts`.
- Steps: token bucket (capacity = `rate_per_min`, uniform refill) per (user, upstream); semaphore `max_concurrent` without queue; additionally a bucket per user (`calls_per_min`) and per `tokenId`; order: user → token → upstream; a violation immediately returns the tool error `rate_limited` with `retry_after` (seconds, rounded up), `_meta.retry_after` and `_meta.limit_scope` (`user`/`token`/`upstream`; the 60/min limit applies **per upstream**, never "per client", E18); upstream `Retry-After` (from `safe-fetch`) blocks the upstream until then and shows up in the status; time source injectable for tests.
- Check: deterministic unit tests with a fake clock (burst, refill, parallelism, retry-after); integration: the 61st call within a minute fails immediately. DoD: green; hits appear in the upstream object of the API (`rateLimitHits5m`, hits of the last 5 min from `call_stat`/counter).

**1.2.5 Timeouts, retry limits, breaker, status**
- Purpose: P0-14 minimum (section 6).
- Files: `upstream/connect.ts`, `upstream/breaker.ts`, `upstream/status.ts`, `tests/unit/breaker.test.ts`, `tests/integration/resilience.test.ts`.
- Steps: uniform deadline helper (see 1.2.3). **Abort per era:** against Streamable HTTP upstreams of revision 2026-07-28, abort means closing the response stream (the SDK client does so on `signal`; evidence by test); against legacy HTTP and stdio the fake expects `notifications/cancelled`; if the v2 client does not send it automatically, the gateway sends it itself (**unverified**, the test decides). Retry only for connect/init/list with jitter. `tools/call`: no retry, except session loss at sessionful legacy upstreams (HTTP 404 on a session request → reinitialize the client, exactly one new attempt). Breaker per spec rule (5 in a row; open 30 s ×2 up to 5 min; half-open one probe call); counts connection errors, timeouts, 5xx; does **not** count `isError`, invalid arguments (protocol error InvalidParams), rate limit, `denied`. Status computation (section 6) with persistence only on change plus audit on `open`/`auth_expired` (category `status`, `result` `status_change`, scope `user`); every change writes `status_reason` (text, e.g. "5 Fehler in Folge, Breaker öffnet für 30 s") and for `open` the retry time (`nextRetryAt` in the API, kept in the breaker's memory); `setup` ≠ `ready` keeps the status at `unknown`.
- Check: fake upstream modes `hang`, `500`, `lose-session`, `slow`, `ok`: timeout after a defined time; abort arrived at the upstream (per era: connection abort or `cancelled`); **no double call** of a non-idempotent tool on timeout/500 (counter at the fake); breaker transitions closed→open→half-open→closed; a hanging upstream A does not occupy the concurrency of B. DoD: green.

**1.2.6 Measurement record write path**
- Purpose: P0-15 minimum, evidence for overhead p95.
- Files: `stats/buffer.ts`, `stats/purge.ts`, `plugins/20-gateway.ts`, `scripts/measure-overhead.ts`.
- Steps: one record per `list`/`call` (fields 4.2); times with `performance.now()`; `upstream_ms` around the SDK call, `overhead_ms = total − upstream`. Buffer in memory, flush every 5 s or at 500 entries as one `INSERT … VALUES …`; upper bound (e.g. 10,000), on overflow drop the oldest and count `stats_dropped`; flush errors are logged, never passed to the caller; no `await` on the DB in the call path. Daily deletion `ts < now() - 14 d` (interval in the process; with several instances later move into a DB job). Sizes: `req_bytes`/`res_bytes` from JSON length, without storing contents. The load script measures **additionally independently** (client total time minus processing time measured by the fake upstream itself), so that a bug in the stats path does not falsify the evidence (B17); `percentile_cont` is computed after stopping the instance via `withDb`.
- Check: load test with a fake upstream (1000 calls) → records complete; DB blocked for 10 s → calls continue, `stats_dropped` rises after overflow; both measurement paths p95 ≤ 50 ms. DoD: green, script checked in.

**1.2.7 Graceful shutdown, `/healthz`, `/readyz`**
- Purpose: P0-10/P0-14 minimum.
- Files: `lifecycle.ts`, `routes/healthz.get.ts`, `routes/readyz.get.ts` (change 0a files).
- Steps: **Clarify first (spike, 0a left it open):** does Nitro call the `close` hook on SIGTERM? If not, the plugin registers an own SIGTERM handler (idempotent, once). SIGTERM → flag "draining" (new `tools/call` → error "Gateway fährt herunter"), running ones up to 30 s, then abort; close listen streams; close pool (incl. `terminateSession`), flush stats; then close the DB (0a). `/healthz`: process alive + `SELECT 1`; `/readyz`: migrations done, supervisor reachable **only if `STDIO_MODE` ≠ off and target `full`**. An upstream outage never affects either.
- Check: test with a running call + SIGTERM; `/readyz` stays 200 with a stopped fake upstream. DoD: green.

**1.2.8 `list_changed` per user (B9, E2)**
- Purpose: 2026 clients learn about catalog changes via `subscriptions/listen` without a user seeing events of another.
- Files: `proxy/notify.ts`, binding to `notifyToolsChanged(userId)` from 0b.
- Steps: **Spike at the beginning** with 0b: choice (a) one `createMcpHandler` per user (lazy, in a map, closed on `onUserDisabled/Deleted` and after idle) or (b) a bus that filters listen streams by `userId` (only if the subscription can carry the context; **unverified**). Priority (a), because separation by construction. Triggers: tool toggle, upstream on/off/delete, change reported by the upstream only if the filtered list changes; debounced (e.g. 200 ms). Limits: `maxSubscriptions` per user, `keepAliveMs` below the proxy timeout (README: no buffering, long timeouts). Listen streams end at `ctx.expiresAt`, on ban and on shutdown.
- Check: A and B each have an open listen stream; A switches a tool → only A gets `tools_list_changed`, B nothing; banning A closes its stream; a 2025 client (stateless) gets no push, sees the change in the next `tools/list`. DoD: green; decision (a)/(b) added in section 4.4.

**1.2.9 Dashboard API (E16, E18)**
- Purpose: clients table and attention card of the dashboard from phase 1, without KPIs and time series (phase 2).
- Files: `gateway/dashboard.ts`, `api/dashboard.get.ts`, types in `shared/api-types.ts`.
- Steps: `clients`: active (non-revoked) OAuth connections and PATs of the user from the 0b read functions (section 3), each with `lastActiveAt` from `last_used_at`; `active` = `lastActiveAt` more recent than `ACTIVE_WINDOW_MS` (5 min); `callsPerMin` from `call_stat` (`kind = 'call'`, last 5 min, grouped by `client_id` for OAuth or `token_id` for PAT, divided by 5, one decimal place); `contextTokensEstimate` = `res_bytes` of the client's most recent `list` record / 4 (rounded, `null` without a record; marked as an estimate in the field name); `allowlisted` only for OAuth (from 0b), otherwise `null`; sorted by `lastActiveAt` descending. `attention`: the user's upstreams with `status` ∈ (`degraded`, `open`, `auth_expired`) together with `statusReason` and `nextRetryAt`; `attentionCount` = length (navigation badge). No device name, no "connected since" statement, no session terms. The stats buffer is not flushed before the query (a lag ≤ 5 s is documented).
- Check: `tests/integration/dashboard.test.ts`: a client with a call 1 min ago → `active`, 6 min ago → inactive (fake clock or set timestamps); PAT and OAuth counted separately; after revocation the row disappears; an upstream in `open`/`auth_expired`/`degraded` appears in `attention`, `healthy`/`disabled`/`unknown` does not; user B sees nothing of A; the response contains neither token nor secret. DoD: green; acceptance 16 (dashboard part).

### Milestone 1.3 — stdio worker + supervisor
Acceptance: an admin creates a stdio upstream via the API (e.g. fake server or `npx` server), calls run through the worker; a second user without approval cannot start one; processes run under their own UID assigned by the supervisor with a clean env; restart/idle/limits work; hardening tests green.

**1.3.0 Spike: pass the socket FD on to the worker (E10, B8)**
- Purpose: decision whether the root supervisor can be removed from the data path.
- Files: throwaway code in the scratchpad, result as a comment in `supervisor/main.ts` and an addendum in E10.
- Steps (timebox ½ day, in the Linux container): the supervisor accepts a Unix socket connection, reads the short `attach` frame, spawns the worker with `stdio: ['ignore','inherit','inherit', socket]` and `uid/gid`, then destroys its own copy. Check: (1) the worker opens `new net.Socket({ fd: 3 })` and reads/writes; (2) the connection stays open after closing the supervisor copy (no `shutdown`), (3) mutual abort: worker exit ⇒ web app sees EOF, web app close ⇒ worker sees EOF, (4) backpressure with large frames, (5) a worker under a foreign UID may use the already inherited descriptor.
- Result: works → design from 4.1 applies. Fails → fallback from E10 (raw byte pipe in the supervisor without parsing and without framing), adjust tasks 1.3.1–1.3.3 accordingly.
- DoD: decision documented before 1.3.1 begins.

**1.3.1 Supervisor skeleton**
- Purpose: process with capabilities, starting the web app, control socket, safe directories and UID assignment.
- Files: `supervisor/main.ts`, `protocol.ts`, `probe.ts`, `users.ts`.
- Steps: start (as root with 3 capabilities): create directories per 4.1 (`/run/mcpwarden` 0755, `DATA_DIR` root 0755, `DATA_DIR/pgdata` web UID, `DATA_DIR/stdio` 0711 root-owned). **Mind the order:** first `mkdir`/`chmod`, then `chown`, because without `CAP_FOWNER`/`CAP_DAC_OVERRIDE` a `chmod` on foreign-owned directories fails. No recursive `chown`; a wrongly owned `pgdata` → clear error message. Start the web app via `spawn(node, ['.output/server/index.mjs'], { uid: WEB_UID, gid: WEB_GID, env: web env })`; exit of the web app ends the container (compose restarts). Signal forwarding (SIGTERM → web app, wait for drain, end workers). Capability probe (4.1). Control socket with length-prefixed JSON frames, version field, hard size limit. `users.ts`: load/atomically write `.uidmap`, `uidFor(userId)` (assignment 20000–59999, never reuse), `ensureUserDir(uid)` with exclusive `mkdir`, `lstat` check, `O_NOFOLLOW`, descriptor `chown`; commands accept only `userId` (format checked), never UID/GID/path.
- Check: unit tests `uidmap` (persistence, concurrency, upper bound, never 0/web UID, reuse excluded); integration with fake web commands incl. forged commands (`uid: 0`, `cwd: "../.."`, `userId` with `/`, overlong frame) → rejected; symlink test (web UID replaces `stdio` with a symlink → not possible since `stdio` is root-owned; a `stdio/<uid>` present beforehand as a symlink → abort instead of `chown`); in the container test: `/proc/<pid>/status` of the web app shows `CapEff` = 0. DoD: green (`CapEff` check in smoke test 1.4).

**1.3.2 Worker lifecycle**
- Purpose: one worker per user, lazy, idle, backoff.
- Files: `supervisor/main.ts`, `supervisor/worker.ts`, `supervisor/users.ts`, `stdio/supervisor-client.ts`.
- Steps: the web app sends `ensureWorker(userId)` or opens the data connection with `attach(userId)`; the supervisor resolves UID/directory itself, starts the worker (`uid`, `gid`, `cwd`, **empty env** with only `PATH`, `HOME`, `TMPDIR`, `LANG`, `NODE_OPTIONS=--max-old-space-size=N`; the test checks that `MASTER_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL` are missing) and hands over the descriptor. Error event of the spawn → clear error "Prozessstart nicht möglich (Rechte)". Idle timeout (default 10 min without open children/calls) → the worker ends together with the children. Crash → restart on the next `attach` with backoff (1 s → 30 s), open calls receive the error "Worker neu gestartet" (the web app sees EOF of the data connection). `stopWorker(userId, { purge })` on ban/delete/withdrawal of approval.
- Check: integration test (section 8, stdio worker test). DoD: green.

**1.3.3 Child processes and IPC transport**
- Purpose: use stdio servers like HTTP upstreams in the pool.
- Files: `supervisor/worker.ts`, `stdio/ipc-transport.ts`, `stdio/supervisor-client.ts`, `upstream/connect.ts`.
- Steps: the web app decrypts env secrets (E4) and sends `startChild({upstreamId, command, args, env, cwdRel})` over the data connection; the worker spawns the child (env = only what was passed + `PATH/HOME/TMPDIR`), checks that `cwd` lies under the user directory (path normalization, symlink resolution; defense in depth, since the worker has only user rights anyway), child count limit; stdout line by line → frame, stdin ← frame, stderr → bounded ring (last N KB for error messages, do not output secrets). The gateway `IpcTransport` implements send/receive/close; the `Client` connects over it; timeouts/breaker/limiter identical to HTTP. The child ends → transport closes → pool entry new, backoff.
- Check: fake stdio server: list/call tools, child dies in the middle of a call → clear error, next call starts anew; too many children → error `limit`. DoD: green.

**1.3.4 Isolation, limits and hardening tests**
- Purpose: P0-5 isolation and resources, evidence of the hardening B5/B6.
- Files: `supervisor/worker.ts`, `Dockerfile` test target.
- Steps: tests in the container (Linux): worker/child sees `id -u` = assigned `uid`, `id -G` contains **no** group 0 (mandatory test; libuv clears supplementary groups); user A cannot read the directory of B; `DATA_DIR/pgdata` not readable; the web app can neither change nor rename `DATA_DIR/stdio` (write attempt as web UID fails); symlink attack: user A creates symlinks in their directory (`home -> /etc`, `tmp -> ../<uid of B>`), then another start/idle cycle: the supervisor changes owner or mode nowhere outside (before/after comparison of `stat` on target paths); `ulimit -u` fork-bomb test limited to the user; memory overrun ends only this worker.
- Check: container integration test `tests/integration/stdio-isolation.test.ts` (Docker needed, in CI as a separate job). DoD: green.

**1.3.5 Approval policy and stdio reasons (API, E13)**
- Purpose: P0-5 approval; the API names the reason for a block, the frontend displays it.
- Files: `stdio/policy.ts`, adjustment of `api/me/capabilities.get.ts` and `api/admin/users/[id]/limits.put.ts` (effect), binding to `api/admin/settings.put.ts` (effect of `stdio.enabled`). No Vue files.
- Steps: policy from 4.2 (instance switch `stdio.enabled`, role/user approval, supervisor capability) replaces the stub from 1.1.6/1.1.8; `capabilities.stdio.reason` delivers exactly one code: `instance_disabled` (admin has stdio globally off), `not_granted` (account not approved), `no_capabilities` (container without SETUID/SETGID/CHOWN, probe `canSwitchUser=false`, for non-admins only), `supervisor_unreachable`, `image_slim`; the check order is in this order, the first hit wins. The API rejects creating/enabling/testing a stdio upstream server-side with 403 `stdio_not_allowed` including `data.reason` (not only in the UI). Withdrawing approval (`stdioAllowed` → false or `stdio.enabled` → false) stops the worker immediately. Audit (scope `instance`). The admin sees only metadata.
- Check: matrix (admin/user × approved/not × capability yes/no × instance on/off × image) via API tests with the expected `reason`. DoD: green; a user without approval never reaches `attach`/`ensureWorker` (test with a forged request against the web API).

### Milestone 1.4 — Docker, hardening, switch, acceptance
Acceptance: images `slim`/`full`, compose example, smoke test, switch test, docs; all phase 1 acceptance criteria met.

**1.4.1 Dockerfile**
- Purpose: P0-10.
- Files: `Dockerfile`, `.dockerignore`.
- Steps: multi-stage (deps → build `nuxt build` with the Node preset → supervisor bundle and `tools/pglite-dump` bundle → runtime); targets `slim` and `full` (E6): `full` adds `uv`/`uvx` (obtained via the official uv image through `COPY --from`, tag/path **unverified**) and the supervisor bundle; `slim` without supervisor, `USER web`, `/data` in the image web-owned (a named volume takes over ownership on first mount); user `web` (UID/GID 10001) without a login shell; `HEALTHCHECK` via `node -e fetch('http://127.0.0.1:3000/healthz')` (no `curl` needed); entrypoint `full`: `node dist/supervisor/main.js`, `slim`: `node .output/server/index.mjs`; `ENV STDIO_MODE` per target (`slim` fixed `off`). No `util-linux`/`setpriv`.
- Check: both targets build, note sizes, `docker run` without capabilities starts and reports stdio blocked. DoD: healthcheck becomes `healthy`.

**1.4.2 compose.yaml and operational details**
- Purpose: P0-10 example compose, TLS proxy hints.
- Files: `compose.yaml`, `compose.test.yaml`, `README.md`.
- Steps: target `full`: `cap_drop: [ALL]`, `cap_add: [SETUID, SETGID, CHOWN]`, `security_opt: ["no-new-privileges:true"]` (`no_new_privs` concerns only `exec` privileges, `setuid()` remains possible), `init: true`, `stop_grace_period: 40s`, `pids_limit`/`mem_limit` as a comment example, volume `data:/data`, ENV per spec (+ E7: `STDIO_MODE`, `TRUST_PROXY`). Target `slim`: `cap_drop: [ALL]` without `cap_add`. Example Postgres service behind profile `pg`. README: ENV table, `BASE_URL` must be HTTPS except `localhost`, reverse proxy without buffering for `/mcp` (listen streams, long timeouts), `X-Forwarded-*`, backup PGlite (volume with the app stopped), switching to Postgres (1.4.3), stdio residual risk (network/kernel shared, a compromised web app reaches the worker), invitation link as a secret (R14: pass on only to the intended person, email binding without verification, no mail sending), no master key rotation, one-time `chown` for old volumes.
- Check: `docker compose up` fresh; second start keeps data. DoD: README instructions followed by hand.

**1.4.3 Switch test PGlite → Postgres (P0-11, B4)**
- Purpose: evidence of the spec promise "switch via dump/import". The import into Postgres is so far **untested** (the SQL dump via `pgDump` from `@electric-sql/pglite-tools` was only produced); the task therefore begins with a spike.
- Files: `tools/pglite-dump.ts` (bundle in the image), `tests/e2e/migrate-pglite-to-pg.sh`, CI job, README section "Switching".
- Steps: (1) Spike: dump a filled PGlite instance (users, upstreams, secrets, stats) with `pgDump({ pg })`, import into an empty `postgres:17`; note and fix options (`--no-owner`/`--no-acl`, exclusion of `call_stat` data), errors and deviations (schema `drizzle`, sequences, extensions, version jumps). (2) Script: stop the app → `docker run --rm --user 10001 -v data:/data … node dist/tools/pglite-dump.mjs > dump.sql` → `psql -f dump.sql` in the Postgres container → start the app with `DATABASE_URL` and the **same** `MASTER_KEY`. (3) Check: login of the existing user, upstreams and tool filter present, secret decryptable (test call against a fake upstream with bearer), `drizzle.__drizzle_migrations` unchanged, no migration run, new registration via invitation possible, sequences continue (new `call_stat` entry without conflict).
- Check: script green locally and as a CI job. DoD: README describes the procedure; open import problems are fixed or documented as a known limitation (acceptance 14).

**1.4.4 Security and acceptance run**
- Purpose: phase acceptance (section 1).
- Files: `tests/e2e/compose-smoke.sh`, small fixes if needed.
- Steps: run the smoke test (section 8), connect real Claude Code, additionally a second client (Cursor locally, fallback MCP Inspector; Claude Desktop/Web with the first public instance) as chosen by the operator; run the overhead script; tick off the checklist of section 1; open points as issues.
- DoD: all 16 acceptance points evidenced (log/test run linked), no known high-risk findings open.

## 8. Test strategy

Tools: Vitest per the 0a harness (built artifact as a child process, `tests/`), Docker for container tests. CI: unit + integration against **PGlite and Postgres** (matrix, `TEST_BACKEND`), separate job for Docker tests, separate job for the switch test. No automatic deployment.

**Fake upstream** (`tests/fixtures/fake-upstream`): MCP server based on the SDK with a control channel (`POST /__ctl` or env/file for the stdio fake). Modes: `ok`, `hang`, `status500`, `slow(ms)`, `lose-session` (404 on a known session), `rate429(retryAfter)`, `auth(token|header)`, `redirect`, `tools(list)`, `listChanged`. Counts calls per tool (evidence of double calls), measures its own processing time (for the independent overhead measurement) and logs `notifications/cancelled`, aborted connections and headers. Variants: HTTP (Streamable 2026-07-28, Streamable legacy with session, pure SSE) and stdio.

**Isolation test user A/B** (from 1.1, mandatory in every milestone): two users (created via `auth.api.createUser`), A has upstream `u1` with secret and tools. B: (1) `GET/PATCH/DELETE /api/upstreams/<ID of A>` → 404; (2) `secret.put`, `test`, `tools`, toggle → 404; (3) `/mcp` `tools/list` contains no tools of A; (4) `tools/call` with `u1__x` → the same error as for non-existent; (5) the same slug is allowed for B and hits B's own upstream; (6) `decryptSecret(B, rowA)` throws; (7) statistics rows (`call_stat`) of A never in B's queries; (8) pool keys contain the user ID (test on the connection set); (9) after `onUserDisabled(A)` A's connections are closed; (10) non-admin B gets 403 on all `/api/admin/*`; (11) `list_changed`: A's toggle produces no notification at B; (12) `GET /api/audit`: B sees no entries of A, the admin sees instance events but never A's user entries; (13) `GET /api/dashboard`: B sees neither A's clients, PATs nor attention entries. Extension 1.3: A's worker does not see B's directory; B cannot trigger a worker for A via the web API.

**SSRF matrix** (unit with fake resolver + integration with a local server; expectation each time: rejected **without connection setup** to the target, evidenced by the local server never seeing an access, message without internal address): literal IPs `127.0.0.1`, `[::1]`, `10.0.0.1`, `172.16.0.1`, `192.168.1.1`, `169.254.169.254`, `100.64.0.1`, `0.0.0.0`, `192.0.2.1`, `198.51.100.1`, `203.0.113.1`, `[2001:db8::1]`, `[2002:7f00:1::]` (6to4 with 127.0.0.1), `[fd00:ec2::254]`, `[::ffff:127.0.0.1]`, `[::ffff:a9fe:a9fe]`, `[64:ff9b::7f00:1]`, decimal/octal/hex notations (`2130706433`, `0x7f.1`, `017700000001`); hostname resolving to a private IP; **rebinding** (the resolver returns public on the first lookup, private on the second → connection fails, since the check is at the connect lookup); hostname with several A records (one private suffices for rejection); redirect 302 to `http://169.254.169.254/` and to `localhost` (fails at `redirect: 'error'`, no follow-up traffic); URL with userinfo; scheme `file:`/`ftp:`; exception list entry (`ssrf.allow`, CIDR or hostname) allows exactly the target and nothing else (not even other hostnames on the same IP for a hostname entry). Additionally per transport (Streamable and SSE): a real connection attempt to a local server is blocked (proves that the `fetch` option takes effect).

**Resilience** (1.2.5): see task; additionally test "one upstream hangs, `tools/list` stays < deadline and delivers the others" and abort test per era (HTTP-2026: the fake sees the connection abort; legacy HTTP/stdio: `notifications/cancelled`).

**Admin and lifecycle** (1.1.9, 1.1.10): invitation matrix (token missing/invalid/expired/revoked/used, email binding, parallel registration, no token in logs/lists/audit), ban (OAuth, PAT, pool, worker), unban, delete (CASCADE, audit stays), path via `/api/auth/admin/*`, last admin protected, no banning/deleting of the own account.

**API contract** (`tests/integration/api-contract.test.ts`, acceptance 15): for each route from 4.5 a test checks status, error shape and field set of the response against the types in `shared/api-types.ts` (runtime check via a zod schema derived from the types or maintained by hand in the test folder) and searches all responses for plaintext secrets and invitation tokens; frontend contract tests (`tests/ui/contract`) can use the same server as `CONTRACT_BASE_URL`.

**stdio worker test** (1.3): (a) lazy: worker/child only on the first call; (b) env check: the child outputs its env (fake command) → only allowed variables, the upstream's secret present, `MASTER_KEY` & co. missing; (c) UID/GID/`id -G`; (d) idle end with a shortened timeout; (e) crash → backoff restart, the running call gets an error; (f) child limit; (g) `cwd` escape (`../`, symlink) rejected; (h) policy matrix; (i) supervisor without capabilities (container without `cap_add`): probe reports `canSwitchUser=false`, non-admin blocked; (j) hardening: forged supervisor commands (UID 0, path, invalid `userId`), symlink and directory tree tests from 1.3.4; (k) no MCP frame passes the supervisor process (counter/strace-free evidence: the supervisor bundle imports neither SDK nor JSON-RPC code, the data connection after `attach` without read access by the supervisor).

**Docker compose smoke** (`tests/e2e/compose-smoke.sh`, 1.4): `docker compose -f compose.yaml -f compose.test.yaml up -d --build` with `full`; wait for `healthy`; `/healthz` 200, `/readyz` 200; register the first user (0a API), create an invitation link for user B via `POST /api/admin/invites` and register B with `X-Invite-Token` (a second use of the link fails), create a PAT (0b helper), create an HTTP fake upstream as a compose service, `tools/list` and `tools/call` via an MCP client script against `/mcp`; call the stdio fake, check `CapEff` of the web app = 0 and worker UID ≠ 0 via `docker exec`; restart the container, data and upstream still there; `slim` variant: stdio blocked, HTTP works; `docker compose stop` → exit within the grace period, no zombie. Cleanup in a trap.

**Switch test** (1.4.3): `tests/e2e/migrate-pglite-to-pg.sh`, own CI job with a Postgres container.

**Further tests:** secret leak scan (logs and API responses do not contain a plaintext secret); config: the app does not start without `MASTER_KEY`; load script overhead (1.2.6); stats buffer (overflow, DB outage).

## 9. Risks

| No | Risk | Countermeasure |
|----|--------|---------------|
| R1 | The handler model of 0b deviates from the assumed seam (`ToolSource`, `AuthContext` without `role`, handler split for `notifyToolsChanged`). | Reconciliation as the first action in 1.1.1; the `ToolSource` seam encapsulates SDK details, phase 1 does not touch the MCP server; request `role` and `notifyToolsChanged` from 0b. |
| R2 | `list_changed` only for 2026 clients (`subscriptions/listen`); 2025 clients show disabled tools until the next `tools/list`. Additional risk: `notify` reaches all streams of a handler (tenant leak). | The server-side check on every `tools/call` keeps security; handler per user or filtered bus (1.2.8) with an isolation test; streams end at token expiry/ban. |
| R3 | v2 validates upstream results against the spec schema; upstreams with slightly deviating responses are rejected instead of being passed through 1:1. | Test early with real servers (at least 3 common ones); if necessary examine raw forwarding at JSON-RPC level for `tools/call`. |
| R4 | Supplementary groups of root are retained on the user switch. Per the libuv source (`setgroups(0, NULL)` when `uid`/`gid` is set, with `CAP_SETGID`) handled. | Mandatory test `id -G` (1.3.4) stays; no `setpriv` fallback, no `util-linux` in the image. |
| R5 | Root process with only 3 capabilities: missing `DAC_OVERRIDE`/`FOWNER` lead to surprising `EACCES` with volume permissions (old volumes with foreign owners, `DATA_DIR` now root-owned). | Order mkdir → chmod → chown, no recursive `chown`, startup check with a clear error message, migration hint in the README. |
| R6 | SSRF gap: mitigated, since the v2 client transports have a `fetch` option (types checked). Residual risk: a transport is built without `safe-fetch`, IP literals bypass `connect.lookup`, the dispatcher does not take effect (R16). | Two check points (literal before connect + `connect.lookup`), `redirect: 'error'`, lint/code search for direct transport construction, integration test with a real local server per transport. |
| R7 | PGlite single connection: stats flush and status writing compete with requests. | Short batch inserts instead of long transactions; flush off the call path; load test against PGlite. |
| R8 | stdio processes have free network egress (known, spec). A user with approval can reach internal services in the container network. | Default: admin only; README warning; hardening P2. |
| R9 | `npx`/`uvx` download packages on first start: long start time (> connect timeout 10 s) and write access to `HOME`. | More generous connection timeout for stdio (default 60 s), `HOME` in the user directory, hint in the UI on first start. |
| R10 | The total name `<slug>__<tool>` exceeds client limits. | Slug ≤ 32 characters (incorporated); test with long tool names; truncation strategy only if it really occurs. |
| R11 | The scope of 1.1 (admin functions, settings, read audit) and 1.2 becomes a bottleneck; in exchange all Vue files drop out (E13). | 1.1 divisible: 1.1.1–1.1.8 (upstreams), 1.1.9–1.1.12 (admin, settings, audit; parallel possible); 1.2 in two acceptances: 1.2.1–1.2.3 (proxy), 1.2.4–1.2.9 (limits/resilience/stats/`list_changed`/dashboard API). |
| R12 | No master key rotation; losing the key makes all secrets unusable. | `key_version` reserved; README: back up the key; plan rotation in phase 2/P1. |
| R13 | Spike 1.3.0 (FD passing) fails or behaves platform-dependently. | Fallback raw byte pipe in the supervisor without parsing (E10); decision before 1.3.1; extra effort low. |
| R14 | The race around an email allowlist disappears with the token link (E14). Residual risk: whoever knows the link can register (passing on, referrer, access logs, browser history); an email binding is not verified; a consumed token on a failed user creation. | Token 256 bits, stored only as a hash, single use, 7 days, revocable, optionally email-bound; atomic claim (no double consumption); token masking in access logs and redaction of the header; public check route with rate limit per IP; the frontend sets `Referrer-Policy: no-referrer` on `/invite/*`; the admin sees registrations and can ban; README note. |
| R15 | Importing the PGlite dump into Postgres is untested; dump format, sequences, schema `drizzle` or version jump may fail. | Switch test with a spike at the start of 1.4.3, CI job, documented limitations. |
| R16 | The `undici` npm dispatcher does not fit the `fetch` built into Node; the dispatcher option is ignored. | Use `undici.fetch` from the installed package with an own dispatcher in `safe-fetch`; a test with a real local server proves the effect. |
| R17 | Nitro does not await async plugins; SIGTERM may not call the `close` hook. | The gateway initializes lazily via `await getDb()`; own SIGTERM handler after the spike in 1.2.7; `/readyz` remains the guarantor. |

## 10. Checked versions and unverified items

Checked (as of 2026-11-04, details in `review.md` S1–S13):
- npm: `@modelcontextprotocol/sdk` 1.32.2 (v1 line, maintenance only); `@modelcontextprotocol/server` 2.4.0, `@modelcontextprotocol/client` 2.4.0, `@modelcontextprotocol/node` 2.1.2 (all Node ≥ 20); `zod` 4.6.7; `undici` 8.12.3; `@electric-sql/pglite` 0.5.15, `@electric-sql/pglite-tools` 0.4.15; nuxt 4.6.4, better-auth 1.7.17.
- Client types v2 (2.4.0): `StreamableHTTPClientTransport` and `SSEClientTransport` have `fetch?: FetchLike`; `RequestOptions` has `signal`, `timeout`, `maxTotalTimeout` (this defuses R6 and "unverified: timeout/signal/fetch").
- Server types v2 (2.4.0): `createMcpHandler` with `legacy: 'stateless' | 'reject'`, `bus`, `maxSubscriptions`, `keepAliveMs`, return `{ fetch, close, notify, bus }`; `subscriptions/listen` is supported, `notify` reaches all open listen streams **of the handler**; helpers `originValidationResponse`, `hostHeaderValidationResponse`, `isLegacyRequest` (origin/host check lies in 0b).
- MCP spec 2026-07-28: no sessions, `list_changed` via `subscriptions/listen`, abort on Streamable HTTP = close the response stream (`notifications/cancelled` only on stdio), origin present and invalid → 403.
- SDK docs v2: stdio `close()` = close stdin, then `SIGTERM`, then `SIGKILL`; Streamable HTTP: `terminateSession()` before `close()`; `StdioClientTransport` options without `uid/gid` (phase 1 uses its own worker for stdio anyway); error classes `ProtocolError`/`SdkHttpError` (status in `.status`); Zod ≥ 4.2.
- Node `child_process.spawn`: options `uid`/`gid`, `env`, `stdio` (stream/socket objects are duplicated as a descriptor, docs; not checked live, spike 1.3.0), `'error'` event for a process that cannot start.
- libuv (`src/unix/process.c`): with `uid`/`gid` set, a preceding `setgroups(0, NULL)`.
- Docker docs: `--cap-add`/`--cap-drop` with `ALL`; `CHOWN`, `SETGID`, `SETUID` belong to the default set and are droppable.
- Linux (capabilities manual, kernel docs): semantics of `CAP_SETUID`/`CAP_SETGID`/`CAP_CHOWN`/`CAP_DAC_OVERRIDE`/`CAP_FOWNER`; `exec` by a non-root UID clears permitted/effective; `no_new_privs` concerns only `exec` privileges, `setuid()` remains possible.
- `pgDump({ pg })` from `@electric-sql/pglite-tools` produces an SQL dump with data and the `drizzle` schema on a PGlite instance; **import into Postgres not tested**.

Unverified (check when building):
- v2 client: whether a `signal` abort against legacy HTTP/stdio automatically sends `notifications/cancelled` (test 1.2.5); interplay of `timeout`/`maxTotalTimeout` with progress notifications; whether all requests of the transports (incl. the SSE stream) use the passed `fetch`; exact `Transport` interface for `IpcTransport`; whether SSE client use is marked as deprecated in v2.
- v2 server/0b: whether a subscription carries the user context for a filtered bus (otherwise handler per user, 1.2.8); role of the legacy path for 2025 clients in `createMcpHandler` (0b confirms with real Claude Code).
- Socket FD passing to `spawn` (`stdio` with socket): behavior on closing the parent copy, backpressure (spike 1.3.0).
- Node: error behavior (`EPERM`) on a missing capability; behavior of `FileHandle.chown` on directory descriptors.
- Compose keys (`init`, `stop_grace_period`, `pids_limit`) against the current compose reference; base image tag (Node 24 LTS, Debian variant); `uv` image path; availability of `prlimit`/`ulimit -v` in the chosen image.
- Whether Nitro calls the `close` hook on SIGTERM (spike 1.2.7, agreed with 0a).
- PGlite dump: options (`--no-owner`, `--no-acl`), import behavior in `postgres:17` (spike 1.4.3); `percentile_cont` behavior identical (the spec claims it, tested along in 1.2.6).
- Maximum tool name length of common clients.
