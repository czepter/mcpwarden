# Review of the implementation plans 0a, 0b, 1

As of: 2026-11-04 · Basis: `docs/spec.md` v0.3, `docs/plans/phase-0a.md`, `phase-0b.md`, `phase-1.md`
Spec and plans were not changed. "Checked" means: verified against the npm registry, official docs, package type definitions or via a spike. "Unverified" is marked.

Language: this document is English; the product UI is German by decision.

## Short summary

The three plans are usable individually, but do not fit together at the seams: almost every "expectation of 0a" from 0b and phase 1 names different paths, exports and helpers than 0a delivers. In addition there are two gaps that none of the plans covers: admin functions from P0-4 (first user = admin, invitation/allowlist, ban/delete users) and the PGlite→Postgres switch test (P0-11). The PGlite spike is done and green (see S1), so 0a no longer depends on U2. One startup problem in 0a is blocking: Nitro does not await asynchronous plugins (B1).
**Approval:** 0a **yes after correction of B1, B2, B3** · 0b **no**, only after the interface reconciliation (section "Interfaces") · phase 1 **no**, only after B2, B4, B5, B6 and the interface reconciliation.

## Checked facts (evidence for the findings)

| ID | Checked | Result |
|---|---|---|
| S1 | Spike in the scratchpad: `better-auth` 1.7.17 + `@better-auth/drizzle-adapter` 1.7.17 (`provider: 'pg'`) + `drizzle-orm` 0.45.4 + `@electric-sql/pglite` 0.5.15, Node 24.13 | Sign-up 200, sign-in 200, 30 parallel `getSession` ok, `migrate()` twice → 1 entry in `drizzle.__drizzle_migrations`, restart with the same `dataDir` ok. U2 (0a) is thereby settled. Not checked: a run inside Nuxt/Nitro. |
| S2 | `npx auth@1.7.17 generate --help` | `--dialect postgresql` (mapped to `pg` for Drizzle). U1 (0a) settled. Generated schema: `id text`, columns explicitly snake_case (`email_verified`, `user_id`). |
| S3 | Schema generation with `admin()`, `jwt()`, `mcp()` | Tables: user, session, account, verification, jwks, oauth_client, **oauth_resource**, **oauth_client_resource**, oauth_refresh_token, oauth_access_token, oauth_consent, oauth_client_assertion. `admin()` adds `role`, `banned`, `ban_reason`, `ban_expires`. The CLI config with `mcp()` needs `baseURL`, otherwise abort ("Invalid URL"); `mcp()` tries to write `resources` into the DB at startup. |
| S4 | `nitropack@2.13.6` `runtime/internal/app.mjs` | `runNitroPlugins` calls `plugin(nitroApp)` without `await`. Async plugins thus run concurrently with the first request. U4 (0a) is **refuted**. |
| S5 | `@nuxt/nitro-server@4.6.4` | h3 `^1.15.11`, nitropack `^2.13.6`. `toWebRequest(event)` is the right way (0b point 8 settled). |
| S6 | `@nuxt/test-utils` 4.3.4 peers | `vitest ^4.0.2 \|\| ^5.0.0`: compatibility given per peer (the 0a rationale "unverified" no longer applies). |
| S7 | `@modelcontextprotocol/client` 2.4.0 types | `StreamableHTTPClientTransport` and `SSEClientTransport` have `fetch?: FetchLike`; `RequestOptions` has `signal`, `timeout`, `maxTotalTimeout`. Phase 1 risk R6 and "unverified: timeout/signal" are thereby defused. |
| S8 | `@modelcontextprotocol/server` 2.4.0 types | `createMcpHandler` options `legacy: 'stateless' \| 'reject'` (default stateless), `bus`, `maxSubscriptions`, `keepAliveMs`; return `{ fetch, close, notify, bus }`. `subscriptions/listen` is supported, `notify` publishes `tools_list_changed` to **all** open listen streams of the handler. The low-level class `Server` is exported, as are `originValidationResponse`, `hostHeaderValidationResponse`, `isLegacyRequest`. |
| S9 | MCP spec 2026-07-28 (transports, Streamable HTTP) | No sessions, no GET stream; `list_changed` via `subscriptions/listen`; sampling/elicitation via MRTR (`InputRequiredResult`), servers no longer send requests; abort on Streamable HTTP = closing the response stream, `notifications/cancelled` only on stdio; origin present and invalid → MUST 403. |
| S10 | Better Auth docs `mcp`, `oauth-provider` | `mcp()` replaces `oauthProvider()`, `jwt()` mandatory; JWT access tokens not revocable server-side, disabled client: existing JWTs stay valid until expiry; refresh rotation with reuse detection (`refreshTokenReuseInterval` for `mcp()` 30 s); rate limits `/oauth2/register` 5/60 s, `/oauth2/token` 20/60 s, only with the global rate limit active (default: production only). The docs example uses `legacy: "reject"`. For DCR there is `clientPrivileges` (can refuse `create`); whether it applies to anonymous DCR is unverified. |
| S11 | `@electric-sql/pglite-tools` 0.4.15 `pgDump({ pg })` on the spike DB | SQL dump with data (`user`) and `drizzle` schema produced. Import into Postgres not tested. O3 (0a) is technically feasible. |
| S12 | libuv `src/unix/process.c` (v1.x) | With `uid`/`gid` set, libuv calls `setgroups(0, NULL)` before `setgid`/`setuid`. Supplementary groups are cleared if `CAP_SETGID` is present. Phase 1 R4 largely settled; the mandatory test `id -G` stays sensible. |
| S13 | npm versions | All versions named in the plans are correct (nuxt 4.6.4, better-auth 1.7.17, drizzle-orm 0.45.4, drizzle-kit 0.31.11, pglite 0.5.15, SDK v1 1.32.2 / v2 2.4.0, `@modelcontextprotocol/node` 2.1.2, vitest 5.1.0, typescript 7.0.2, zod 4.6.7, undici 8.12.3). |

## Findings

| ID | Plan / section | Severity | Finding | Correction |
|---|---|---|---|---|
| B1 | 0a task 7, U3/U4; phase 1 §3 plugins | blocking | Nitro does not await async plugins (S4). `00-init.ts` with `await getDb(); await runMigrations()` lets requests through before the migration ends; the phase 1 plugin `20.gateway` starts before the migration. | Init as a memoized promise in `getDb()` (the migration runs in it exactly once), `getAuth()` waits for it. All DB consumers are thereby automatically secured. The plugin only kicks off `getDb().catch(exit(1))`. `/readyz` stays. Record U4 as refuted in the plan. |
| B2 | 0a O1/§8, 0b E8/E10/E11/E13, phase 1 §3 | blocking | P0-4 has no owner: "first user = admin", role, `banned`, `requireAdmin`, invitation/allowlist, admin page (list, ban, delete users), `onUserDisabled/Deleted`. 0a defers to phase 1, phase 1 presupposes it from 0a/0b, 0b needs it already for the DCR admin page and the ban check. | 0a: `admin()` plugin in migration 0000 (S3), hook "first user gets `role=admin`", `requireAdmin`. Phase 1: new task in 1.1 "invitations/allowlist, user list, ban (sessions, OAuth refresh tokens, PATs), delete" incl. `user-lifecycle.ts`. |
| B3 | 0a O1, task 8 | important | The registration lock via `count(*)` in the `before` hook is a race: two parallel first registrations both get through (two admins). Moreover after the lock no test can create a second user, yet 0b/phase 1 need user B for isolation tests. | Serialize sign-up in a process-wide mutex (single instance suffices). Create second users in tests via `auth.api.createUser` of the admin plugin; helper `createUser()` in the 0a harness. |
| B4 | phase 1 §1/§7, spec P0-11 | blocking (coverage) | The switch test dump PGlite → import Postgres → start with a new `DATABASE_URL` is in no plan (0a O3 refers to phase 1, phase 1 does not have it). | Task in phase 1 (e.g. 1.4.3): `pgDump` (S11) → `psql` in a Postgres container → app with `DATABASE_URL` → login and upstreams present. CI job. README section backup/switching. |
| B5 | phase 1 §4.1, 1.3.1, 1.3.2 | blocking (security) | `ensureWorker({userId, uid})` comes from the web app. The plan does not check that the supervisor validates the UID. A compromised web app could request `uid: 0` or its own UID; a child with UID 0 keeps the permitted capabilities (SETUID) and can assume any UID. | The supervisor accepts only `uid` in the fixed range (≥ 20000, ≠ web UID, ≠ 0), `gid = uid`, `cwd` only under the own stdio tree. Test with a forged command. |
| B6 | phase 1 1.3.1 | blocking (security) | `DATA_DIR` is chowned to the web UID, `DATA_DIR/stdio` lies inside it. The web app can rename `stdio` and replace it with symlinks; the supervisor (root, `CAP_CHOWN`) then chowns arbitrary paths to a user UID. | Separate trees: `DATA_DIR` root-owned 0755, `DATA_DIR/app` (pgdata) web UID, `DATA_DIR/stdio` root 0711. Create user directories with `mkdir` (exclusive) + `lchown`/`O_NOFOLLOW` check. Carry the deviation from the spec path `DATA_DIR/stdio/<user_id>` (the plan uses `<uid>`) into the spec. |
| B7 | phase 1 1.1.4 | important (security) | The check via undici `connect.lookup` does not apply to IP literals (no DNS lookup). The test matrix contains literals, the implementation does not cover them. | Additionally `assertPublicAddress()` on literal hosts before the connect (after WHATWG URL normalization, which resolves decimal/hex/octal). Extend the block list by `192.0.2/24`, `198.51.100/24`, `203.0.113/24`, `2001:db8::/32`, `2002::/16` (6to4, check embedded v4). SDK transports get their own `fetch` (S7); `redirect: 'error'` for MCP transports instead of manual following. |
| B8 | phase 1 §4.1 | important (security) | The root supervisor parses all MCP frames between web app and worker. Thereby every byte from foreign stdio children lies in the data path of the privileged process. | The supervisor passes per worker an accepted socket connection of the web app as `stdio[3]` to the worker (the `spawn` option `stdio` accepts socket streams, the FD is duplicated; Node docs, not checked live). Afterwards data flows directly web app ↔ worker. If rejected: hard-limit the frame size. |
| B9 | 0b assumption 2, R11; phase 1 E2, R2 | important | "Without a session no `list_changed` push" is true only for 2025 clients. 2026-07-28 clients use `subscriptions/listen`, `createMcpHandler` brings bus and `notify` (S8, S9). | Phase 1: publish `tools_list_changed` on disable/toggle. Mind tenant isolation: `notify` goes to all streams of the handler. Either handler per user or a bus that filters by `userId`. 2025 clients: no push, accept. |
| B10 | phase 1 §6, 1.2.6; spec P0-14 | important | Abort via `notifications/cancelled` no longer applies to 2026 upstreams over HTTP; there closing the stream is the abort (S9). The test plan expects `cancelled` at the fake. | Test per era: HTTP-2026 → the fake sees the connection abort; legacy/stdio → `notifications/cancelled`. Adjust the spec text P0-14. |
| B11 | 0b task 6, A5 | important | The additional check per request covers user banned, client disabled, consent deleted. A single token revocation (RFC 7009 on the refresh token, consent stays) takes effect only after the JWT expires. The spec edge case "token/session revoked → 401 on the next request" is thereby not met for this case. | Either additionally check whether a valid refresh token still exists for `(user, client)`, or document the deviation (≤ TTL 5 min) in the spec. Recommendation: add the check, one more query. |
| B12 | 0b task 1 step 4 | small | Table list incomplete: `oauth_resource`, `oauth_client_resource` are missing (S3). `mcp()` writes resources into the DB at startup; with 0a `auth.cli.ts` (`{} as never` as DB) there is an error message on generation, generation works with `baseURL` set. | Correct the list; `auth.cli.ts` sets `baseURL`. |
| B13 | 0b task 2 | small | `mcp()` delivers the protected-resource metadata itself (S10), but only under the auth handler. A parallel own build drifts. | Pass the root routes `/.well-known/*` through to `auth.handler` or the plugin helpers instead of building JSON ourselves. |
| B14 | 0b task 4 step 2 | small | DCR gate: check `clientPrivileges` (can refuse `create`) before the Nitro middleware; effect on anonymous DCR unverified. | Test in the spike of task 1; middleware only as a fallback. |
| B15 | 0b task 3 step 3 | small | "Spec requires hostname display and extra warning for localhost": not in `spec.md` (stems from the MCP spec). | Name the source correctly; keep the requirement. |
| B16 | 0a task 10, 0b 6.1 | important | Tests run against the build (`NODE_ENV=production`), where the Better Auth rate limit is active (default: production only). Several sign-ins per test run into 429. 0b wants rate limits on/off per test run. 0a forbids new ENV variables without a spec change. | Add a test ENV (e.g. `RATE_LIMIT=off`) to the ENV list (see E7) or switch limits via the test config through an admin setting. |
| B17 | phase 1 §1 A12, 1.2.7 | small | The acceptance criterion overhead p95 depends on the own stats write path; a bug there falsifies the evidence. | Additionally measure overhead from outside in the load script (client time minus fake upstream time). |
| B18 | spec "Phases" | important | P0-14 and P0-15 are assigned to no phase; phase 1 takes parts (E3), the rest "phase 2", spec phase 2 does not know them. P0-3 (PAT) belongs to phase 1 per the spec, 0b pulls it forward (sensible). | Add spec phases: P0-14/P0-15 minimum in phase 1, rest in phase 2; P0-3 in 0b. |
| B19 | spec framework, P0-1, P0-5, P0-10, P0-12, P1 | important | Spec texts outdated or overtaken by reasoned plan decisions: SDK package name (v2), "session ID in the header", decryption "by the supervisor", ENV list, "URL elicitation (2025-11-25)" and `sampling/createMessage` (2026: MRTR, S9). | Spec v0.4: changes section with the points from E1, E2, E4, E7 and the MRTR note for phase 2/3. |
| B20 | 0a §2 TS 7 | small | TypeScript 7.0.2 with `vue-tsc`/`nuxi typecheck`: `vue-tsc` 3.3.14 requires only `>=5.0.0`, function with TS 7 unverified. | Pin TS 5.9/6.x by default, TS 7 later as its own task. Saves a false start in task 1. |
| B21 | phase 1 1.3.4, R4 | small | The groups trap is solved per the libuv source (S12); the `setpriv` fallback is presumably not needed. | Keep the test, do not put `util-linux` into the image as a precaution. |
| B22 | phase 1 1.1.2 | small | `gen_random_uuid()` is a core function since Postgres 13, PGlite is based on Postgres 17. Low risk; covered by the migration test anyway. | Replace the "unverified" note with a test in 1.1.2. |
| B23 | all | important | Migrations from parallel branches collide in the drizzle-kit journal (`meta/_journal.json`). | Schema changes strictly sequential (0a → 0b → 1), CI step `db:check` (0a task 6) mandatory. |

## Interface reconciliation (expectation vs. 0a/0b)

The type `user.id` is `text` everywhere (0a §8, 0b E8, phase 1 A5; generated schema confirms, S2). All other points deviate.

| Topic | 0a delivers (§3, §8) | 0b expects (§3) | Phase 1 expects (§3) | Decision |
|---|---|---|---|---|
| Configuration | `getConfig()` from `process.env`, `server/utils/config.ts` | E1 `runtimeConfig` in `nuxt.config.ts` | `getConfig()` ✓ | 0a variant; drop 0b E1. |
| DB client | `getDb(): Promise<Db>` in `server/db/index.ts` | E2 `export db` in `server/db/index.ts` | `export const db` in `server/db/client.ts`, `casing: snake_case`, `withTx` | `getDb()` (async needed because of B1). No `casing` flag: the generated schema names columns explicitly (S2), own tables likewise. Drop `withTx` (YAGNI, PGlite: no long tx). |
| Auth instance | `getAuth(): Promise<Auth>` in `server/auth/index.ts`, options in `options.ts` | E4 `export auth`; E6 plugin array, `basePath` known | – | `getAuth()`; 0b adds plugins in `options.ts` (0a §8). |
| Migration/scripts | `db:schema`, `db:generate`, `db:check`; `server/plugins/00-init.ts` | E7 `db:generate-auth`, `db:migrate`, `server/plugins/migrate.ts` | `server/plugins/00.migrate.ts`, own plugin `20.gateway.ts` | 0a names; phase 1 `server/plugins/20-gateway.ts`, waits for `getDb()` (B1). |
| Migration numbers | `0000_init` | "0001" for OAuth (+ `mcpw` tables) | `00NN_phase1_*` | Order 0000 (0a incl. `admin()`), 0001 (0b OAuth), 0002 (0b own), from 0003 phase 1; names assigned by drizzle-kit. |
| Role/ban | none (O1 defers the admin plugin to phase 1) | E8 `role`, E11 `banned`, first user admin | `role`, `banned` | in 0a via `admin()` (B2). |
| Session helpers | `requireUser(event) → { user, session }` | E10 `requireUserSession`, `getSessionOrNull`, `requireAdmin` | `requireUserSession → { userId, role }`, `requireAdmin` | one name: `requireUser` + `requireAdmin` in `server/utils/session.ts` (0a). |
| Pages | `/login`, `/register` | E9 `/sign-in`, `loginPage: "/sign-in"` | – | `/login`; 0b `loginPage: "/login"`. |
| UI base | button, input, label, card | E13 admin layout, table, dialog, alert, badge, select | layout with nav, `/admin` guard | 0b adds components and admin layout. |
| Settings | – | E14 `mcpw_app_setting` | `instance_setting` | **one** table (0b creates it, phase 1 uses it). |
| Table prefix | – | `mcpw_` | without prefix | uniformly without prefix (Better Auth tables have none either). |
| Key derivation | `deriveUserKey` "later in `master-key.ts`" | E15 `server/utils/crypto.ts` | `server/gateway/crypto/secrets.ts` | one file: `server/gateway/crypto/secrets.ts`; adjust 0a §8. `decryptSecret` takes `userId` from the auth context, never from the row. |
| Auth context `/mcp` | – | `AuthContext` in `server/auth/auth-context.ts` (`tokenType`, without `role`) | `GatewayAuth` in `server/utils/gateway-auth.ts` (`kind`, `role`), `requireGatewayAuth(request)` | 0b type and path; add field `role` (access-guard reads the user row anyway). |
| Seam to the gateway | – | `ToolSource { listTools(ctx), callTool(ctx, name, args) }` in `server/mcp/upstream-port.ts` | `createGatewayServer(auth)` in `server/gateway/index.ts` delivers an MCP server | Keep `ToolSource`, add `callTool(ctx, name, args, { signal })`. Phase 1 implements `ToolSource`, does not touch the SDK server object. `list_changed` (B9) via the handler from 0b. |
| Scope | – | `mcp:tools` | "`mcp`" | `mcp:tools`. |
| Origin check | – | A8, `server/middleware/origin-check.ts` | 1.2.1 only "if not in 0b" | in 0b; drop phase 1 task 1.2.1. |
| Audit | – | explicitly not in 0b (§9) | E9 "0b creates `audit_log`" | Phase 1 1.1 creates `audit_log` + `audit()`. |
| Logger | – | – | `server/utils/logger.ts` with redaction | Phase 1 creates (in 1.1). |
| Lifecycle | – | – | `user-lifecycle.ts` from 0a/0b | Phase 1 (B2). |
| Health | `/healthz`, `/readyz` in 0a | E17 unchanged | in §5 as new files | Phase 1 changes the 0a files (supervisor check). |
| Tests | `tests/`, build as child process, `TEST_BACKEND`, `TEST_PG_ADMIN_URL` | E12 `test/helpers/`, `@nuxt/test-utils` | `test/helpers/db.ts` `createTestDb()`, `TEST_DATABASE_URL`, `@nuxt/test-utils` | 0a harness and variables for all; folder `tests/`. `@nuxt/test-utils` would be possible per peer (S6), but two harnesses are one too many. |
| ENV | six spec names, "new ones only with a spec change" | `ALLOWED_ORIGINS` | + `STDIO_MODE`, `SUPERVISOR_SOCKET`, `WEB_UID/GID`, `TRUST_PROXY` | see E7. |

## Recommendations on the decisions

### I can recommend alone

| Point | Recommendation | Rationale |
|---|---|---|
| Phase 1 E1 SDK v2 | v2 (`@modelcontextprotocol/server`/`client` 2.4.0, `node` 2.1.2) | stable line, the Better Auth docs build on it, required options present (S7, S8). |
| E3 scope P0-14/15 | as proposed | timeouts/breaker/measurement path sit in the call path; carry the spec phases over (B18). |
| E4 decryption in the web app | accept | the supervisor stays without key and DB; the protection goal "worker env clean" remains. The web app holds the key anyway. Change the spec text P0-5. |
| E5 one container, the supervisor starts the web app | accept, with B5, B6, B8 | root→non-root `setuid` clears permitted/effective; `no_new_privs` prevents regaining. |
| E6 slim/full | accept; in `slim` stdio is fixed off (no supervisor bundle), not just a default | otherwise "slim = HTTP/REST only" (spec) is only a preset. |
| E7 additional ENV | only `STDIO_MODE` and `TRUST_PROXY` (+ a test switch, B16); socket path and web UID as constants | YAGNI; fixed values in the image. Add the list to spec P0-10. |
| E8 new tools on by default | yes | Spec P0-7 is silent; rug-pull protection comes with the P1 poisoning check. |
| E9 `audit_log` | phase 1 creates | 0b excludes audit. |
| 0a O2 OAuth tables only in 0b | yes | Generation with `mcp()` works later (S3); migration 0001. |
| 0a O3 switch test not in 0a | yes, but phase 1 must carry it (B4) | `pgDump` works (S11). |
| 0b O2 TTL 5 min / refresh 30 d | yes | with the additional check per request (and B11) the TTL is secondary. |
| 0b O3 scopes `openid offline_access mcp:tools`, `mcpwarden:admin` reserved | yes | Align phase 1 to `mcp:tools`. |
| 0b O4 DCR rate limit 5/min | yes | works only with an active rate limit and a correct client IP behind the proxy (0a R9). |
| 0b assumption 4 DCR without CIMD | yes for 0b | observe in A1/A2 whether Claude Code or Cursor prefer CIMD; `@better-auth/cimd` 1.7.17 exists as a follow-up task. |
| 0b `legacy: 'stateless'` | yes (not `reject` as in the docs example) | 2025 clients must be served; confirm with real Claude Code in task 5. |

### The user must decide

| Point | Question | Recommendation |
|---|---|---|
| Phase 1 E2 / P0-1 / P0-5 | Change the spec: "stateless (2026-07-28), 2025 clients stateless without a session" and "`list_changed` for 2025 clients only on the next `tools/list`"? | yes; build the push for 2026 clients via `subscriptions/listen` into phase 1 (B9). Sessionful legacy only if a target client demonstrably needs it. |
| 0a O1 | Lock registration after the first user until invitations exist? | yes, with a mutex (B3). When do invitation/allowlist come: proposal phase 1, milestone 1.1 (B2). |
| B2 location of the admin functions | Admin plugin in 0a, user management in phase 1 1.1? | yes. |
| B11 | Single-token revocation effective immediately (one more query) or document a delay of ≤ 5 min? | effective immediately. |
| 0b O1 | second mandatory client | Cursor (local, without tunnel), fallback MCP Inspector; Claude Desktop/Web with the first public instance in phase 1.4. |
| B18/B19 | Spec v0.4 with the collected changes | yes, before the start of 0b. |
| Spec question 6 | stdio idle 10 min, max. 5 children | adopt the phase 1 defaults. |

## Start order

**Immediately (after incorporating the 0a corrections B1, B2, B3, B20 into the plan):**
- 0a task 1 (scaffold; Node ≥ 24.15, TS 5.x/6.x), task 2 (Tailwind/shadcn), task 3 (config/master key).
- 0a task 4 (DB layer) and task 5 (auth factory, schema generation with `admin()`): the PGlite spike (U2) is done (S1), `--dialect postgresql` clarified (S2).

**Still depends on a spike in the real Nuxt build:**
- 0a task 7: check init via the memoized `getDb()` promise (B1) and copying the migrations folder into `.output` (R3) in the built artifact. Whether Nitro calls the `close` hook on SIGTERM (for A2, clean PGlite closing) is unverified and to be checked along here.
- 0a task 10/11: fix the rate-limit switch for tests (B16) beforehand.

**Decide before the start of 0b:**
- Adopt the interface table above (paths, `getDb`/`getAuth`, `requireUser`/`requireAdmin`, `/login`, table prefix, settings table, test harness, `AuthContext` with `role`, `ToolSource` with `signal`).
- Spec v0.4 (B18, B19), E2.

**Decide before the start of phase 1:**
- Include B2 (admin/invitations in 1.1), B4 (switch test), B5/B6/B8 (supervisor hardening) in the plan; fix the E7 list.
