# Phase 0b: OAuth provider and first end-to-end slice

As of: 2026-11-04 (revised after `docs/plans/review.md`) · Basis: `docs/spec.md` v0.3 · Dependency: phase 0a (`docs/plans/phase-0a.md`). Where 0a has not yet been adjusted, the decisions of the reconciliation table in the review (section 3) apply.

Language: this document is English; the product UI is German by decision.

Labeling: **assumption (confirmed 2026-11-04)** = recommendation of the review, confirmed collectively by the user.

**Responsibility (confirmed 2026-11-04, consequence of `docs/ui-comparison.md`, question 1):** the frontend (`docs/plans/frontend.md`) takes over **all** Vue files under `app/**`. 0b delivers only `server/**`, tests and contract contributions in `shared/api-types.ts`. The consent page, DCR admin page and the token and clients pages are built by the frontend against the routes in section 4.1. Tasks 3 to 5 are therefore reduced to the API side (routes, data shapes, tests).

## 1. Goal and acceptance criteria

First vertical slice: login → consent → token → `tools/list`/`tools/call` against a dummy upstream, via `/mcp`.

Done when all items are met:

- [ ] A1: `claude mcp add --transport http mcpwarden <BASE_URL>/mcp`, then `/mcp` in Claude Code → browser login → consent → connected. Claude Code sees `dummy__echo` (and further dummy tools) and calls them successfully.
- [ ] A2: **Cursor** as the second mandatory client connects via OAuth and calls a dummy tool (confirmed 2026-11-04; fallback only with a demonstrated Cursor problem: MCP Inspector, then recorded in the log as a deviation; Claude Desktop/Web only with the first public instance in phase 1.4; see 6.3).
- [ ] A3: Automated flow test (DCR → authorize → login → consent → token → refresh → `/mcp` → revocation → 401) is green against PGlite and against Postgres (CI matrix from 0a).
- [ ] A4: Discovery: `/.well-known/oauth-protected-resource` (and path variant `/mcp`) as well as `/.well-known/oauth-authorization-server` return correct JSON. Invalid/missing auth on `/mcp` → 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, no tool leak.
- [ ] A5: A token with the wrong audience is rejected (401). **Immediate revocation:** after banning the user, disabling/deleting the client, revoking the consent **and** revoking only the refresh token (RFC 7009, consent stays), the next request with a still-valid JWT yields 401, without waiting for expiry (task 6). The same for PATs after revocation or after the user is banned.
- [ ] A6: DCR policy `off` / `allowlist only` / `open with warning` switchable via the admin API, default `open with warning`; `consent-info` returns `allowlisted` per client so that the frontend can warn for unknown clients and require an active confirmation. The admin routes are reachable only for `role=admin` (non-admin: 403, anonymous: 401).
- [ ] A7: PATs create/name/revoke (API); only the hash is stored; plaintext once in the POST response; `last_used_at`; `Authorization: Bearer mcpw_pat_…` works on `/mcp`.
- [ ] A8: Origin check: invalid `Origin` → 403; missing `Origin` (CLI clients) is let through.
- [ ] A9: `tools/list_changed` via push: a 2026-07-28 client (SDK client v2) keeps `subscriptions/listen` open; a server-side trigger (dummy tool switch, stands for the phase 1 toggle) delivers `tools_list_changed` to it. A second user with an open stream gets **nothing** (tenant isolation). 2025-11-25 clients get no push and see the change on the next `tools/list` (deliberately accepted).
- [ ] A10: Abort over HTTP = closing the response stream: if the client aborts a running `tools/call` (`slow_echo`), the `ToolSource` sees the `AbortSignal` within a short time (test).
- [ ] A11: Contract: `shared/api-types.ts` contains types for every route from section 4.1; the routes satisfy them (`satisfies`), shape tests (task 9) are green, secrets appear in no response type.

Note on A1 and A2: login, consent and clients pages come from the frontend (frontend plan tasks 7 to 9). The manual acceptance (task 10) presupposes these pages; until then the automated flow test (A3) covers the flow.

## 2. Assumptions and open points

Checked versions (npm registry or official docs, fetched 2026-11-04; cross-checked in the review, S13):

| Package | Version | Source |
|---|---|---|
| `better-auth` | 1.7.17 | npm |
| `@better-auth/mcp` | 1.7.17 | npm, better-auth.com/docs/plugins/mcp |
| `@better-auth/oauth-provider` | 1.7.17 | npm, docs |
| `@better-auth/cimd` | 1.7.17 | npm, docs |
| `@modelcontextprotocol/server` / `client` | 2.4.0 | npm, ts.sdk.modelcontextprotocol.io/v2 |
| `@modelcontextprotocol/sdk` (v1 line) | 1.32.2 | npm |
| `nuxt` | 4.6.4 (Nitro 2, h3 v1) | npm |
| `drizzle-orm` | 0.45.4 | npm |
| `@electric-sql/pglite` | 0.5.15 | npm |
| MCP specification | 2026-07-28 is "latest"; 2025-11-25 is the older revision | modelcontextprotocol.io |

Decisions and assumptions:

1. **SDK package name:** the spec names `@modelcontextprotocol/sdk`; as of today that is the v1 line. v2 is called `@modelcontextprotocol/server`/`client`, the Better Auth docs use v2, the required options exist per the type definitions (review S7, S8). **Decision per review: v2.** Adjust the spec text in v0.4. Fallback v1.32.x (`StreamableHTTPServerTransport`, stateless) not elaborated further.
2. **Spec revision and statelessness:** 2026-07-28 is stateless (no `initialize` requirement, no `Mcp-Session-Id`, no GET stream). `createMcpHandler` serves 2025-11-25 clients statelessly by default (`legacy: 'stateless'`, GET/DELETE → 405). **confirmed 2026-11-04:** the spec line "session ID in the header" (P0-1) does not apply; the gateway is stateless; `legacy: 'stateless'` instead of `'reject'` (the docs example uses `reject`, which would lock out 2025 clients; confirm with real Claude Code in task 7). Sessionful legacy only if a target client demonstrably needs it.
3. **`list_changed` (replaces the earlier assumption "no push"):** for 2026-07-28 clients there is `subscriptions/listen`; `createMcpHandler` returns `bus` and `notify` (return `{ fetch, close, notify, bus }`, review S8). 0b builds the path in (task 8), phase 1 triggers it on disable/toggle. **Tenant isolation:** `notify` goes to all open listen streams **of one handler**. Therefore not one global handler, but **one handler per user** (default) or a bus filtering by `userId` (variant B, decision in the spike of task 8). 2025 clients: no push, accepted.
4. **Better Auth plugin choice:** `mcp()` from `@better-auth/mcp` (replaces `oauthProvider()`, do not register both; do not use the older `mcp` plugin from `better-auth/plugins`, status unverified). `jwt()` is mandatory. The `admin()` plugin comes from 0a (migration 0000).
5. **DCR vs. CIMD:** assumption per review (confirmed 2026-11-04): DCR is mandatory in 0b, `@better-auth/cimd` is not in scope. Observe in A1/A2 whether Claude Code or Cursor prefer CIMD. Build the allowlist logic so that it later also applies to CIMD `client_id` hosts.
6. **Revocation of JWT access tokens:** per the docs not revocable server-side; a disabled client leaves existing JWTs valid until expiry. **Decision (confirmed 2026-11-04, review B11):** short access token TTL (5 min, `accessTokenExpiresIn: 300`) **plus** a DB check on **every** request (task 6), which applies to a still-valid JWT **and** to the refresh token state: user active, client active, consent present **and** at least one non-revoked, non-expired refresh token for (user, client). A deviation "≤ 5 min" is deliberately not accepted (one more query).
7. **Access token format without `resource`:** with `resource` in the request the value is in `aud`; without it the token is opaque. `mcp()` gets `resource` fixed; behavior for a missing parameter is tested in the spike (task 1) and if necessary enforced via a default resource (`clientRegistrationDefaultResources`, unverified) or the request is rejected. Note: `mcp()` writes resources into the DB at startup (`oauth_resource`, `oauth_client_resource`, review S3).
8. **Issuer path:** Better Auth hangs off the `basePath` (`/api/auth`). The spec requires `/.well-known/oauth-authorization-server` at the root. We deliver the root routes as thin Nitro routes that pass through to `auth.handler` or the plugin helpers (`oauthProviderAuthServerMetadata(auth)`), no JSON built by ourselves (review B13). Alternatively choose `basePath` so that issuer = `BASE_URL`: decision in task 1 based on the actual output.
9. **Nitro integration:** settled (review S5): `toWebRequest(event)` (h3 v1, Nuxt 4.6.4). Open only whether a web `Response` (including streaming for `subscriptions/listen`) can be returned directly from the h3 1.15 handler; mini test in task 7 (fallback `sendWebResponse`).
10. **Scopes:** `openid offline_access mcp:tools` (confirmed 2026-11-04). Uniform name `mcp:tools` (review decision, not `mcp`; the UI drafts showed `mcp`, the frontend adopts `mcp:tools`). `mcpwarden:admin` (P0-12) is **not effective** in 0b: neither in `scopes`/`scopes_supported` nor in `consent-info`. The name is reserved. **Confirmed 2026-11-04:** from phase 2 the user can separately deselect `mcpwarden:admin` when consenting (two switches; the consent call passes the subset of scopes). In 0b the consent data delivers the admin scope only if it is enabled; until phase 2 it stays hidden.
11. **Tables and names:** no prefixes (`mcpw_` is dropped), consistent with Better Auth. One settings table `app_setting` (0b creates it, phase 1 uses it). Audit does not belong to 0b (phase 1 creates `audit_log` and `audit()`).
12. **Time budget/order of the clients:** Claude Code (localhost, HTTP allowed) and Cursor are mandatory; Claude Desktop/Web need a publicly reachable HTTPS URL and come in phase 1.4.
13. **Status word "Aktiv" instead of session terms (confirmed 2026-11-04, comparison W7):** the gateway is stateless, there is no connection or session. The API never speaks of "online", "session" or "connected since". It delivers `lastUsedAt` and the derived `active` (last call at most 5 minutes ago). For this the access check (task 6) writes a timestamp per (user, client), throttled (at most once per minute). The display words "Aktiv"/"Inaktiv" are set by the frontend.
14. **Audit visibility (confirmed 2026-11-04, concerns phase 1):** users see only their own audit entries, admins additionally instance events. 0b creates no audit; the interface (`audit()` and read route) belongs to phase 1, here only as a boundary condition for section 10.

Open questions to Christian (each with the adopted recommendation of the review):

- O1: Second mandatory client Cursor (fallback MCP Inspector)? confirmed 2026-11-04: yes.
- O2: Access token TTL 5 min, refresh TTL 30 days? confirmed 2026-11-04: yes.
- O3: Scopes `openid offline_access mcp:tools`, `mcpwarden:admin` only reserved? confirmed 2026-11-04: yes; the admin scope can later be separately deselected when consenting (assumption 10).
- O4: DCR rate limit 5/min per IP? confirmed 2026-11-04: yes. Works only with an active rate limit and a correct client IP behind the proxy (0a R9).
- O5: Single-token revocation effective immediately (DB check incl. refresh token)? confirmed 2026-11-04: yes.
- O6: Spec v0.4 (SDK name, stateless, push via `subscriptions/listen`, abort semantics, P0-3 in 0b) before the start of 0b? confirmed 2026-11-04: yes; 0b starts on the basis of this plan if necessary.
- O7: Test switch for the rate limit (see expectation E16). confirmed 2026-11-04: one additional test ENV, 0a decides the name.

## 3. Expectations of 0a

What counts is what 0a delivers per the review's reconciliation table. Check each row against the finished 0a plan and carry over deviations here.

| # | Expectation | Place/name |
|---|---|---|
| E1 | Configuration via `getConfig()` from `process.env` (no `runtimeConfig`): `baseUrl: URL`, `betterAuthSecret`, `masterKey`, `databaseUrl?`, `dataDir`, `allowedOrigins: string[]`. ENV names fixed: `BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL`, `DATA_DIR`, `ALLOWED_ORIGINS` (0b needs no further ENV except the test switch E16) | `server/utils/config.ts` |
| E2 | DB via `getDb(): Promise<Db>` (asynchronous, memoized, one client per process). The migration runs **inside** the memoized promise exactly once (review B1: Nitro does not await async plugins). No `casing` flag, no `withTx` | `server/db/index.ts` |
| E3 | Schema files in `server/db/schema/`, barrel `schema/index.ts`; Better Auth schema generated in `schema/auth.ts`; own tables as additional files with `user_id` (text) → `user.id` | `server/db/schema/` |
| E4 | `getAuth(): Promise<Auth>` (memoized, waits for `getDb()`); options in `buildAuthOptions(cfg)` | `server/auth/index.ts`, `server/auth/options.ts` |
| E5 | Catch-all `server/api/auth/[...all].ts` with `auth.handler(toWebRequest(event))`; `basePath` `/api/auth`; `baseURL` from `BASE_URL` | 0a task 8 |
| E6 | Plugins are added in `buildAuthOptions` in **one** place; 0b adds `jwt()` and `mcp()` | `options.ts` |
| E7 | Schema scripts `db:schema`, `db:generate`, `db:check` (CI mandatory step, review B23); `auth.cli.ts` sets `baseURL` (otherwise generation aborts with `mcp()`, review B12). Migrations strictly sequential: 0000 (0a, incl. `admin()`), 0001 and 0002 (0b), from 0003 phase 1. No parallel schema branches | `package.json`, `scripts/gen-auth-schema.sh` |
| E8 | Tables `user` (IDs as **text**), `session`, `account`, `verification`; through `admin()` additionally `user.role` (`admin`/`user`), `banned`, `ban_reason`, `ban_expires` (migration 0000) | `server/db/schema/auth.ts` |
| E9 | The first user gets `role=admin`; registration locked afterwards, sign-up serialized via a process-wide mutex (review B3). Further users in tests via `auth.api.createUser` of the admin plugin | `options.ts` |
| E10 | Pages `/login` and `/register` (not `/sign-in`) including auth middleware belong to the frontend (frontend plan task 6/7), not to 0a and not to 0b. 0b needs from 0a only the API under `/api/auth/*`; the signed query that the plugin appends to `loginPage`/`consentPage` must be preserved by the frontend (handover in task 4) | `app/**` (frontend) |
| E11 | Server helpers `requireUser(event) → { user, session }` and `requireAdmin(event)` (403 for non-admins) in one file. 0b calls `requireAdmin` for every admin route | `server/utils/session.ts` |
| E12 | Banning a user via `admin()` (`banned`, `ban_expires`) ends sessions; the state is queryable via DB. The complete lifecycle (`user-lifecycle.ts`, revocation of OAuth/PAT access on ban, delete) is phase 1; 0b covers ban/delete via the access check per request | `user.banned` |
| E13 | Test harness from 0a for all phases: folder `tests/`, built artifact as a child process (`.output/server/index.mjs`), `TEST_BACKEND=pglite|postgres`, `TEST_PG_ADMIN_URL`, `startServer(env)`, `api()` helper with cookie jar, helper `createUser()` (admin API). No `@nuxt/test-utils` | `tests/integration/harness.ts` |
| E14 | Dropped for 0b: UI components and layouts (incl. admin layout) are delivered by the frontend. 0b creates nothing under `app/**` | – |
| E15 | No crypto helpers needed for 0b (PAT hash via SHA-256). Key derivation (`deriveUserKey`, `decryptSecret`) lives later in `server/gateway/crypto/secrets.ts` (phase 1); 0b creates no `crypto.ts` | – |
| E16 | The Better Auth rate limit is active in the build (production); there is a test ENV (name set by 0a, e.g. `RATE_LIMIT=off`) so that many sign-ins per test do not run into 429; for the DCR rate-limit test it is switched on in a separate run (review B16) | `options.ts`, harness |
| E17 | `/healthz` and `/readyz` exist; 0b does not change them | 0a |
| E18 | Init plugin `server/plugins/00-init.ts` only kicks off `getDb().catch(exit(1))`; `/readyz` stays (review B1) | 0a task 7 |
| E19 | Uniform error shape of the own routes via h3 `createError`: `{ statusCode, statusMessage, data: { code, field?, message } }` (wish E10 of the frontend plan). If 0a fixes a different shape, 0a applies and `ApiErrorBody` in `shared/api-types.ts` follows it | `shared/api-types.ts` |
| E20 | `shared/api-types.ts` (first version from the frontend, rules there section 4: only types, ISO-8601 strings, `Ms` suffix, never secrets, import alias `#shared/api-types`). 0b adds the types from section 4.1 in the same commit as the respective route. If the file does not exist yet, 0b creates it with exactly these types | `shared/api-types.ts` |

Deviations cost mainly in task 1 (plugin integration, schema) and in the test harness. Everything 0b creates itself lies in its own files, so that no collisions with 0a arise.

## 4. Files and paths

New (paths relative to the repo root; Nuxt 4, `server/` Nitro; `app/**` belongs to the frontend and is neither created nor changed by 0b):

```
server/auth/mcp-plugin.ts            Plugin configuration (mcp(), jwt()), scopes, resource
server/auth/dcr-policy.ts            DCR policy + allowlist matcher (pure, testable)
server/auth/dcr-hook.ts              Binding to /oauth2/register (clientPrivileges/hook or Nitro middleware)
server/auth/client-meta.ts           Expiry cleanup for OAuth clients, derivation of lastUsedAt/active/expiresAt
server/auth/access-guard.ts          authenticateMcpRequest(): check token + additional DB check per request
server/auth/auth-context.ts          Type AuthContext + mapper from token/PAT
server/auth/pat.ts                   Create/verify/revoke PAT
server/db/schema/mcp.ts              app_setting, dcr_allowlist, oauth_client_meta, oauth_connection_use, personal_access_token
server/db/migrations/…               generated migrations: 0001 (OAuth tables from Better Auth), 0002 (own tables)
server/api/admin/oauth/policy.get.ts / policy.put.ts                 read/set DCR mode (requireAdmin)
server/api/admin/oauth/allowlist.get.ts / allowlist.post.ts / allowlist/[id].delete.ts / allowlist/reset-builtins.post.ts
server/api/admin/oauth/clients.get.ts / clients/[id].patch.ts / clients/[id].delete.ts   list/disable/revoke clients
server/api/oauth/consent-info.get.ts                 Client info + allowlist status for the consent page (frontend)
server/api/me/pats.get.ts / pats.post.ts / pats/[id].delete.ts       PAT endpoints
server/api/me/connections.get.ts / connections/[clientId].delete.ts  User's clients (consents) + revocation
shared/api-types.ts                  Contribution: types of all routes above (section 4.1)
server/routes/mcp.ts                 /mcp (POST; GET/DELETE → 405)
server/routes/.well-known/oauth-protected-resource.get.ts
server/routes/.well-known/oauth-protected-resource/mcp.get.ts
server/routes/.well-known/oauth-authorization-server.get.ts
server/routes/.well-known/oauth-authorization-server/[...path].get.ts   (if the issuer has a path)
server/mcp/handler.ts                Handler per user (createMcpHandler), gate order, origin check
server/mcp/notify.ts                 notifyToolsChanged(userId), closeUserStreams(userId), maximum stream run time
server/mcp/dummy-upstream.ts         Dummy upstream (echo, add, slow_echo, whoami, toggle_tool)
server/mcp/upstream-port.ts          ToolSource interface for phase 1 (see section 10)
server/mcp/errors.ts                 401/403 responses with WWW-Authenticate
tests/integration/oauth/…            Flow tests (see 6)
tests/integration/api/…              Route and shape tests of the self-service and admin routes
tests/integration/mcp/…              Endpoint tests
tests/unit/dcr-policy.test.ts        Matcher table
tests/helpers/oauth-client.ts        Minimal OAuth test client (fetch-based, PKCE)
docs/manual-tests/phase-0b.md        Acceptance log (file is created during the acceptance run)
```

Change: `server/auth/options.ts` (add plugins `jwt()`, `mcp()`, rate-limit rules), `server/auth/auth.cli.ts` (`baseURL`, new plugins), `server/db/schema/index.ts` (barrel), `package.json`, `README.md` (section "Connecting a client"). `.env.example` does not change (`ALLOWED_ORIGINS` comes from 0a); only if 0a introduces a test switch (E16) it is documented there.

New dependencies: `@better-auth/mcp`, `@modelcontextprotocol/server`, `zod` (if not present); dev: `@modelcontextprotocol/client` (test client). `@better-auth/oauth-provider` presumably comes as a dependency of `@better-auth/mcp` (check when installing). Pin versions exactly.

### 4.1 Routes and response shapes (contract with the frontend)

All routes require a session (`requireUser`; without a session 401), the `/api/admin/*` routes additionally `requireAdmin` (non-admin 403). Every query filters by the `userId` of the session; foreign IDs yield 404, never 403. Timestamps are ISO-8601 strings, collections are unpaginated lists `{ items: [...] }` (small data volumes; 0b defines no paging). Errors have the shape `ApiErrorBody` (E19). The table reconciles the data needs from `docs/ui-comparison.md` section 5; deviations are listed below the table.

| Route | Purpose / screen | Request | Response (success) | Error (`data.code`) |
|---|---|---|---|---|
| `GET /api/oauth/consent-info` | Consent | Query = the signed query appended by the plugin, passed through unchanged | 200 `ConsentInfo` | 400 `invalid_consent_query` (signature/deadline), 404 `client_not_found` |
| `GET /api/me/pats` | Tokens | – | 200 `PatList` | – |
| `POST /api/me/pats` | Tokens (create) | `{ name }` | 201 `PatCreated` | 400 `invalid_name`, 409 `pat_limit_reached` |
| `DELETE /api/me/pats/:id` | Tokens (revoke) | – | 204 (idempotent, also for an already revoked PAT) | 404 `not_found` |
| `GET /api/me/connections` | Clients | – | 200 `ConnectionList` | – |
| `DELETE /api/me/connections/:clientId` | Clients (revoke) | – | 204 | 404 `not_found` (no consent of this user) |
| `GET /api/admin/oauth/policy` | Admin clients (DCR) | – | 200 `DcrPolicy` | – |
| `PUT /api/admin/oauth/policy` | Admin clients (DCR) | `{ mode }` | 200 `DcrPolicy` | 400 `invalid_mode` |
| `GET /api/admin/oauth/allowlist` | Admin clients (DCR) | – | 200 `AllowlistList` | – |
| `POST /api/admin/oauth/allowlist` | Add entry | `AllowlistInput` | 201 `AllowlistEntry` | 400 `invalid_entry` (with `field`) |
| `DELETE /api/admin/oauth/allowlist/:id` | Remove entry | – | 204 | 404 `not_found` |
| `POST /api/admin/oauth/allowlist/reset-builtins` | Restore presets | – | 200 `AllowlistList` | – |
| `GET /api/admin/oauth/clients` | Registered clients | – | 200 `OAuthClientAdminList` | – |
| `PATCH /api/admin/oauth/clients/:id` | Disable/enable client | `{ disabled }` | 200 `OAuthClientAdmin` | 404 `not_found` |
| `DELETE /api/admin/oauth/clients/:id` | Revoke client (deletes client together with consents and tokens) | – | 204 | 404 `not_found` |

Types (contribution to `shared/api-types.ts`; names are binding, fields may only grow backward compatibly):

```ts
export type DcrMode = 'off' | 'allowlist' | 'open';
export type DcrPolicy = { mode: DcrMode };               // default 'open'

// Consent: name, redirect URIs, allowlist status, scopes (without titles, titles live in the frontend)
export type ConsentRedirect = { uri: string; host: string; loopback: boolean };
export type ConsentScope = { name: string; required: boolean };
export type ConsentInfo = {
  client: {
    id: string;
    name: string;                  // untrusted, truncated to 80 characters, render as text only
    redirects: ConsentRedirect[];
    allowlisted: boolean;          // computed live against the current allowlist
    registeredAt: string;
    viaDcr: boolean;
  };
  scopes: ConsentScope[];          // 'mcp:tools' required:true; 'openid'/'offline_access' required:true; 'mcpwarden:admin' only if enabled (never in 0b)
  resource: string;                // BASE_URL + '/mcp'
  loopback: boolean;               // at least one redirect URI is loopback (additional warning)
};

// PATs: plaintext only in PatCreated.token
export type PatSummary = {
  id: string; name: string;
  prefix: string;                  // 'mcpw_pat_' + 4 characters (comparison W13)
  createdAt: string; lastUsedAt: string | null; revokedAt: string | null;
};
export type PatList = { items: PatSummary[]; limit: { max: number; active: number } };  // max = 20
export type PatCreated = PatSummary & { token: string };
export type PatCreateInput = { name: string };          // 1 to 64 characters

// Clients of the user (UI word "Clients", path stays "connections")
export type ConnectionSummary = {
  clientId: string; name: string;
  scopes: string[]; redirectHost: string;
  allowlisted: boolean;
  grantedAt: string;
  lastUsedAt: string | null;       // last call on /mcp, throttled to 1 min precision
  active: boolean;                 // lastUsedAt at most 5 min ago; display "Aktiv"/"Inaktiv" in the frontend
};
export type ConnectionList = { items: ConnectionSummary[] };

// Admin: allowlist and registrations
export type AllowlistEntry = {
  id: string; label: string; namePattern: string;
  redirectPatterns: string[]; builtin: boolean; createdAt: string;
};
export type AllowlistInput = Pick<AllowlistEntry, 'label' | 'namePattern' | 'redirectPatterns'>;
export type AllowlistList = { items: AllowlistEntry[] };
export type OAuthClientAdmin = {
  id: string; name: string; redirectUris: string[];
  createdAt: string; lastUsedAt: string | null;
  userCount: number;               // number of consents
  allowlisted: boolean;            // computed live
  registeredVia: 'dcr' | 'admin';
  disabled: boolean;
  expiresAt: string | null;        // createdAt + 30 days as long as never used; otherwise null (the frontend computes "Verfall in 24 Tagen")
};
export type OAuthClientAdminList = { items: OAuthClientAdmin[] };
```

Deviations and stipulations compared with the comparison (section 5):

- **Devices** (`MacBook Pro` and the like) are not delivered by 0b: DCR and PAT know no device (comparison item 3). The frontend shows name, redirect host and times.
- **Scopes with title:** `consent-info` delivers only the raw names. The frontend plan (E4) wishes for titles; the titles live in the label table of the frontend (comparison W2). If the frontend wants titles from the server, it adds `title` backward compatibly.
- **Consent** does not run through a route of its own but through the Better Auth client plugin (`oauth2.consent({ accept, scope })`). `scope` is a subset of the offered scopes; from phase 2 the user deselects `mcpwarden:admin` with it. The server accepts no subset without `mcp:tools`.
- **PAT display prefix** is set to `mcpw_pat_` plus 4 characters (comparison W13); the hash stays SHA-256 over the full token.
- **Retrieval:** the frontend fetches all these routes only on the client (frontend A5). 0b sets `Cache-Control: no-store` on the lists.
- **Audit:** no 0b route (see sections 9 and 10).

## 5. Tasks

The order is binding; a green intermediate state after every task. For each task write the test first where sensible. Schema changes strictly sequential (migration 0001 in task 1, 0002 in task 3); `db:check` runs in every task with a schema change.

### Task 1: Integrate Better Auth as the OAuth provider (including spike)

- **Purpose:** auth server endpoints, schema and configuration stand. At the same time clarification of the open points 6 to 8 from section 2.
- **Files:** `server/auth/mcp-plugin.ts`, `server/auth/options.ts`, `server/auth/auth.cli.ts`, `package.json`, generated schema/migration 0001.
- **Steps:**
  1. Install packages (section 4).
  2. In `buildAuthOptions` (`options.ts`): add `jwt()` and `mcp({ loginPage: "/login", consentPage: "/consent", resource: \`${baseUrl}/mcp\`, scopes: ['openid', 'offline_access', 'mcp:tools'], accessTokenExpiresIn: 300 })` (`mcpwarden:admin` stays outside, assumption 10). `admin()` stays from 0a. If `/token` of the JWT plugin collides: `disabledPaths: ["/token"]` (check the effect).
  3. `allowDynamicClientRegistration: true` and `allowUnauthenticatedClientRegistration: true` (anonymous DCR; policy gate in task 3). `clientRegistrationDefaultApplicationType: "infer"` (Cursor hint of the docs).
  4. `auth.cli.ts`: set `baseURL`; generate the schema (`pnpm db:schema`), migration `pnpm db:generate --name oauth` (0001). Expected tables (review S3): `jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `oauth_client_assertion`. Check in the migration; check restart and Postgres run.
  5. Clarify spike questions: (a) actual endpoint paths and issuer; (b) token format (JWT/opaque) with and without `resource`, claims (`sub`, `aud`, `scope`, `azp`/`client_id`, `sid`); (c) does `clientPrivileges` (can refuse `create`) take effect on anonymous DCR? Then that is the preferred policy gate (review B14); (d) existence of a `before` hook for `/oauth2/register`; (e) schema of the refresh token table (columns for revocation/expiry; basis of task 6); (f) behavior of `mcp()` at startup (writes resources into the DB) with the memoized `getAuth()` from 0a.
  6. Add results as a comment at the top of `mcp-plugin.ts` and in section 2 of this plan.
- **Check:** `GET <BASE_URL>/api/auth/.well-known/oauth-authorization-server` (or actual path) returns `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `code_challenge_methods_supported: ["S256"]`, `jwks_uri`. `POST /api/auth/oauth2/register` with example metadata returns `client_id`.
- **DoD:** migration 0001 checked in; the app starts on PGlite and Postgres; spike findings documented; points 6 to 8 decided.

### Task 2: Discovery endpoints and WWW-Authenticate

- **Purpose:** clients find the auth server (RFC 9728, RFC 8414).
- **Files:** `server/routes/.well-known/*`, `server/mcp/errors.ts`.
- **Steps:**
  1. `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`: pass through plugin helpers or `auth.handler` instead of building JSON ourselves (review B13); build it ourselves only if the plugin exposes no suitable handler (SDK helper `oauthMetadataResponse`). Content: `resource` = `${BASE_URL}/mcp`, `authorization_servers`, `scopes_supported`, `bearer_methods_supported: ["header"]`.
  2. `/.well-known/oauth-authorization-server` at the root: hang `oauthProviderAuthServerMetadata(await getAuth())` on a Nitro route; if the issuer has a path, additionally the path variant and possibly `openid-configuration`.
  3. `errors.ts`: `unauthorized(request, {error?, scope?})` builds `401` with `WWW-Authenticate: Bearer resource_metadata="<BASE_URL>/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"`; `forbidden` for `insufficient_scope` (403). Header value exactly per MCP spec.
  4. URLs always from `BASE_URL` (`getConfig()`), never from the `Host` header or `X-Forwarded-*`.
- **Check:** contract test: JSON fields, `Content-Type: application/json`, CORS headers on well-known routes (`Access-Control-Allow-Origin: *`, GET/OPTIONS; metadata is public).
- **DoD:** both discovery documents match the actual endpoints; test green.

### Task 3: DCR policy, allowlist, client management (admin API)

- **Purpose:** P0-2 DCR policy with three modes, allowlist, admin routes, expiry. Comes before the consent API because that uses the matcher. The admin page `/admin/oauth` is built by the frontend (frontend plan task 9) against the routes from section 4.1.
- **Files:** `server/db/schema/mcp.ts`, `server/auth/dcr-policy.ts`, `dcr-hook.ts`, `client-meta.ts`, `server/api/admin/oauth/*`, type contribution in `shared/api-types.ts` (`DcrMode`, `DcrPolicy`, `AllowlistEntry`, `AllowlistInput`, `AllowlistList`, `OAuthClientAdmin`, `OAuthClientAdminList`). No files under `app/**`.
- **Schema** (migration 0002 via `pnpm db:generate --name oauth_admin`; own tables without prefix, text IDs or text foreign keys to `user.id`):
  - `app_setting(key text pk, value jsonb, updated_at)`: the project's only settings table (phase 1 uses it too). Key `oauth.dcr_mode` ∈ `off|allowlist|open`, default `open`.
  - `dcr_allowlist(id, label, name_pattern, redirect_patterns jsonb, builtin bool, created_at)`. Preset (idempotent seed on first access, memoized, via `getDb()`; no hand-edited migrations): Claude Code, Claude Desktop/Web, Cursor, VS Code, Windsurf, Zed, Codex. Patterns e.g. `http://localhost:*`, `http://127.0.0.1:*`, `cursor://`, `vscode://`; Claude web callback URLs are **unverified** and to be looked up during the spike.
  - `oauth_client_meta(client_id pk/fk, allowlisted bool, registered_via text ('dcr'|'admin'), created_at)`. `allowlisted` holds the state at registration; the API fields `allowlisted` compute the matcher live against the current allowlist. No `last_used_at` here, it is derived from `oauth_connection_use`.
  - `oauth_connection_use(user_id text fk→user on delete cascade, client_id fk, last_used_at, pk(user_id, client_id))`: time of the last `/mcp` call per (user, client), written by the access check (task 6, throttled to 1 min). Source for `lastUsedAt`/`active` in `ConnectionSummary` and `OAuthClientAdmin`.
- **Steps:**
  1. `dcr-policy.ts`: pure functions `evaluateRegistration(mode, allowlist, metadata) → {allow, allowlisted, reason}` and `matchesAllowlist(entry, name, redirectUris)`. Rules: `https` or loopback (`http://localhost`, `127.0.0.1`, `[::1]`) or registered app schemes; no wildcards outside the allowlist patterns; `:*` means any port. Always reject `javascript:`, `data:` and the like. `client_name` is untrusted (limit length, render as text only).
  2. `dcr-hook.ts`: gate before `POST /api/auth/oauth2/register`. Order of the variants per the spike (task 1): (1) `clientPrivileges`, (2) Better Auth hook `hooks.before` with path match, (3) fallback Nitro middleware before the catch-all that reads the body, applies the policy and passes the request with a newly created body (`new Request`) to `auth.handler`. Mode `off`: 403 with an RFC 7591-conformant error response; `allowlist` + not listed: 400 `invalid_client_metadata`/`invalid_redirect_uri`. After success a row in `oauth_client_meta` (`allowlisted`).
  3. Rate limit `/oauth2/register`: Better Auth `rateLimit.customRules` (docs default 5/min per IP), test with the limit switched on (E16).
  4. `lastUsedAt` (client level) = maximum of `oauth_connection_use.last_used_at` over all users of the client; no hook after `/oauth2/token`.
  5. Expiry: delete never-used registrations (no entry in `oauth_connection_use`) older than 30 days (daily task; Nitro `scheduledTasks` experimental, otherwise `setInterval` in a plugin, single instance suffices; time mockable in the test). `OAuthClientAdmin.expiresAt` = `createdAt + 30 days` as long as the client was never used, otherwise `null`.
  6. Admin routes per section 4.1: `policy` (read/set), `allowlist` (read, add, remove, `reset-builtins`), `clients` (read with `userCount` from `oauth_consent`, `PATCH {disabled}` via `adminUpdateOAuthClient`, `DELETE` = revocation with deletion of client, consents and tokens; existing JWTs end immediately thanks to task 6 and `closeUserStreams` for affected users as soon as available). The hint text that the allowlist is "convenience/warning logic, not a security feature" is shown by the frontend; the API delivers only data.
  7. **All** admin routes call `requireAdmin(event)` from 0a (E11); a page middleware of the frontend is only a convenience, the server check is authoritative. The admin sees only metadata.
- **Check:** unit tests of the matcher table (among others `http://evil.com`, `http://localhost.evil.com`, `cursor://` without path, IPv6 loopback, userinfo in URL); integration tests of the three modes against `/oauth2/register`; shape tests of the admin routes against the types from section 4.1 (keys, types, `expiresAt` rule); non-admin and anonymous calls of the admin routes → 403/401.
- **DoD:** all three modes work; default `open`; allowlist seeded; all admin routes deliver the contractual shapes and are reachable only for admins; deletion task tested; types in `shared/api-types.ts`.

### Task 4: Consent API and handover for the login redirect

- **Purpose:** the frontend can display consent and denial; unknown clients are marked in the data. Login, registration and consent page (incl. warning box, mandatory checkbox, loopback extra warning, scope switch) are built by the frontend (frontend plan task 7); 0b delivers route, data shape and tests.
- **Files:** `server/api/oauth/consent-info.get.ts`, type contribution in `shared/api-types.ts` (`ConsentInfo`, `ConsentRedirect`, `ConsentScope`), comment block "Frontend handover" in `server/auth/mcp-plugin.ts`. No files under `app/**`.
- **Steps:**
  1. `consent-info.get.ts` (only with a session, otherwise 401): check the query with `verifyOAuthQueryParams(query, secret)` (invalid or expired → 400 `invalid_consent_query`), load the client publicly (`getOAuthClientPublic`; unknown → 404 `client_not_found`), build the response `ConsentInfo` per section 4.1: `client.name` truncated (untrusted), `redirects` with `host` and `loopback` per URI, `loopback` overall (additional warning per MCP spec on loopback redirects, not from `spec.md`), `allowlisted` live via the matcher from task 3, `registeredAt`/`viaDcr` from `oauth_client_meta`, `resource` from `BASE_URL`.
  2. `scopes`: the requested scopes, filtered to the known ones (`openid`, `offline_access`, `mcp:tools`), each `required: true`. `mcpwarden:admin` only if it is enabled; in 0b it is not, so the data never contains it (confirmed 2026-11-04, assumption 10). From phase 2 it is delivered with `required: false`, so that the frontend offers it as a second switch.
  3. Consent does not go through this route but through `authClient.oauth2.consent({ accept, scope })` (Better Auth client plugin). Server requirement: a subset without `mcp:tools` is rejected; declining leads to the redirect with `error=access_denied` (plugin). In the spike (task 1) check whether a subset in the `scope` parameter is accepted by the plugin (basis for phase 2).
  4. **Frontend handover** (as a comment in `mcp-plugin.ts`, result of the spike from task 1): which signed query the plugin appends to `loginPage` and `consentPage`, that the pages must preserve it unchanged (also across the redirect of the auth middleware to `/login`, 0b R14), and which client plugin call continues the authorize flow after login (`oauthProviderClient()`, details in the spike).
- **Check:** shape test of `consent-info` (known client `allowlisted:true`, unknown `false`, loopback flag, invalid signature 400, without session 401, scope list without `mcpwarden:admin`); the overall flow in the flow test (task 9).
- **DoD:** `consent-info` delivers the contractual shape; the handover note is in the code; types in `shared/api-types.ts`.

### Task 5: Personal access tokens and the user's clients (API)

- **Purpose:** P0-3 (in 0b per review B18, not phase 1) and the user story "revoke clients". Comes before the guard that checks PATs. The pages `/settings/tokens` (dialog "Token benennen", plaintext visible once with copy, empty state, limit hint) and `/settings/connections` (UI word "Clients", confirmation before revocation) are built by the frontend (frontend plan task 8).
- **Files:** `server/auth/pat.ts`, `server/api/me/pats.get.ts`, `pats.post.ts`, `pats/[id].delete.ts`, `server/api/me/connections.get.ts`, `connections/[clientId].delete.ts`, type contribution in `shared/api-types.ts` (`PatSummary`, `PatList`, `PatCreated`, `PatCreateInput`, `ConnectionSummary`, `ConnectionList`); table `personal_access_token` in `schema/mcp.ts` (migration 0002, task 3). No files under `app/**`.
- **Steps:**
  1. Table `personal_access_token(id uuid pk, user_id text fk→user on delete cascade, name, token_hash unique, prefix, created_at, last_used_at, revoked_at)`; `prefix` is the display prefix `mcpw_pat_` plus 4 characters (13 characters, comparison W13).
  2. Create (`POST /api/me/pats`): `mcpw_pat_` + 32 random bytes base64url (`crypto.randomBytes`), plaintext only in the response `PatCreated.token`; name required (1 to 64 characters, otherwise 400 `invalid_name`); cap of 20 active PATs per user (constant, otherwise 409 `pat_limit_reached`).
  3. List (`GET /api/me/pats`): `PatList` with all PATs of the user (also revoked ones, recognizable by `revokedAt`) and `limit { max, active }`. Revoke (`DELETE`): set `revoked_at` (row stays, the audit table comes only in phase 1), idempotent, `closeUserStreams(userId)` as soon as available. **Every** query filters by `user_id` from the session. All routes via `requireUser`.
  4. The user's clients (`GET /api/me/connections`): the user's consents as `ConnectionSummary` (client name, `redirectHost`, `scopes`, `grantedAt`, `allowlisted`, `lastUsedAt` from `oauth_connection_use`, `active` = at most 5 min ago). No terms like "session" or "online" (assumption 13). Revoke (`DELETE …/:clientId`) = `deleteOAuthConsent` plus deleting the refresh/access tokens of this client for this user (per the docs, refresh revoke deletes the derived access tokens; test the behavior) and `closeUserStreams(userId)` (task 8, as soon as available); without a consent of this user 404.
  5. `Cache-Control: no-store` on all lists; no plaintext in logs.
- **Check:** user B (created via `createUser()`) can neither see nor revoke the PAT/consent of A (404); plaintext is not in DB and logs (test taps the table and the log output) and only in the POST response, never in GET; shape tests against the types from section 4.1 (among others prefix length 13, `limit.max` 20, 21st PAT → 409).
- **DoD:** routes for PATs and clients deliver the contractual shapes; isolation test green; types in `shared/api-types.ts`. The `/mcp` proof (A7) follows in task 7.

### Task 6: Token verification, audience and access check

- **Purpose:** P0-2 audience binding and **immediate revocation**; a uniform `AuthContext` for OAuth tokens and PATs.
- **Files:** `server/auth/access-guard.ts`, `auth-context.ts`.
- **Steps:**
  1. Read the bearer from `Authorization` (never from the query). Prefix `mcpw_pat_` → PAT path; otherwise OAuth path.
  2. Spike decision (variant after task 1): `requireMcpAuth(auth, handler, { resource, requiredScopes: ["mcp:tools"], challengeScopes })` from `@better-auth/mcp` (checks signature, issuer, audience, expiry; 401 with RFC 9728 challenge, 403 on a missing scope) **or** `verifyAccessTokenRequest` from `better-auth/oauth2` with self-built responses, if we need own hooks before the MCP handler. Record the result here and in section 8.
  3. Audience test: `aud` ≠ `${BASE_URL}/mcp` → 401 `invalid_token`.
  4. **Additional check on every request, also for a still-valid JWT** (`authenticateMcpRequest`), the result is not cached (immediate effect before latency; a cache with 5 s TTL only if measurement demands it):
     - User exists, `banned` is false or `ban_expires` expired.
     - Client exists and is not `disabled`.
     - `oauth_consent` for (user, client) present.
     - **Refresh token state:** at least one non-revoked, non-expired refresh token for (user, client) exists (review B11; catches single-token revocation per RFC 7009 with an existing consent). On rotation the new token replaces the old one, the condition stays met. Open point: tokens without `offline_access` have no refresh token; only the consent check applies to them (check in the spike, otherwise fix `offline_access` as a required scope).
     - One (possibly combined) indexed query per request; the user row at the same time delivers `role` for the context.
     - After a passed check (OAuth path) set `oauth_connection_use.last_used_at` for (user, client), throttled to at most once per minute and without slowing the call (source for `lastUsedAt`/`active`, assumption 13).
  5. PAT path: look up the SHA-256 of the token (256-bit randomness, no salt needed) in `personal_access_token`: not revoked, user not banned (same check as above); `last_used_at` throttled (at most once per minute, without slowing the call). Constant-time comparison.
  6. Build the `AuthContext` (section 10, incl. `role`) and pass it to the SDK as `authInfo` (`extra` carries `userId`, `role`, `tokenType`, `tokenId`).
- **Check:** expired, wrong signature, wrong audience, scope missing (403 `insufficient_scope`), user banned, client disabled, consent deleted, **only refresh token revoked (consent stays) → immediately 401**, PAT revoked, token passthrough prohibition (trivial in 0b, since no real upstream). Measurement of the gate overhead (target ≪ 50 ms, PGlite).
- **DoD:** both token kinds yield the same `AuthContext`; revocation takes effect on the next request, the test proves it without waiting for expiry.

### Task 7: Minimal `/mcp` endpoint with dummy upstream

- **Purpose:** `initialize`, `tools/list`, `tools/call` via a dummy upstream; gate and origin check.
- **Files:** `server/routes/mcp.ts`, `server/mcp/handler.ts`, `dummy-upstream.ts`, `upstream-port.ts`.
- **Steps:**
  1. Mini spike: returning a web `Response` (also streamed) from the h3 1.15 handler; request via `toWebRequest(event)` (settled). Result as a comment in `routes/mcp.ts`.
  2. `handler.ts`: per user `createMcpHandler(() => buildServer(ctx), { legacy: 'stateless' })` (task 8 delivers the per-user management; here one handler suffices at first, structure such that the rebuild stays small). The factory receives the `AuthContext` per request (SDK docs: `ctx.authInfo` or `ctx.http.authInfo`; confirm the mapping when building).
  3. **Gate order (fixed):** (a) origin: `originValidationResponse(request, allowedOrigins)` from the SDK (ignores ports, a missing `Origin` passes; invalid → 403) with `getConfig().allowedOrigins` (contains the origin of `BASE_URL` by default) plus `hostHeaderValidationResponse` with the host from `BASE_URL`; (b) method: only POST, GET/DELETE → 405 (stateless); OPTIONS only if browser clients demonstrably need it; (c) token → `authenticateMcpRequest` (task 6), on failure the response from `errors.ts`; (d) additional check (part of (c)); (e) `handler.fetch(request, { authInfo })`. There is no separate origin middleware (a property of `/mcp`, not of the auth endpoints).
  4. `dummy-upstream.ts` implements `ToolSource` with slug `dummy`: `echo` (text), `add` (numbers, schema validation), `whoami` (returns `userId`, `role`, token type, scopes from the context), `slow_echo` (reacts to the `AbortSignal`, for task 8), `toggle_tool` (hides/shows a dummy tool and calls `notifyToolsChanged(ctx.userId)`; test helper for A9, later replaced by the phase 1 toggle). Names outward `dummy__echo` etc. (P0-1). Tool errors as `isError: true`.
  5. `upstream-port.ts`: `ToolSource { listTools(ctx): Promise<ToolDef[]>; callTool(ctx, name, args, opts: { signal: AbortSignal }): Promise<CallToolResult> }`. The handler knows only this interface; phase 1 implements it with the real registry and does not touch the SDK server object. No further abstraction.
  6. `tools/list` without a valid token delivers nothing: 401 before the MCP handler. Unknown methods/tools yield JSON-RPC errors, no stack traces.
- **Check:** handler test with `fetch`: without token 401 + header; wrong origin 403; GET 405; with PAT `tools/list` ok. Second test with the SDK client (`@modelcontextprotocol/client`, Streamable HTTP) against the test server.
- **DoD:** `initialize`, `tools/list`, `tools/call` run with a 2025-11-25 client and a 2026-07-28 client (SDK client v2 negotiates automatically, log the version in the test). A7 (PAT on `/mcp`) and A8 met. Connect early with real Claude Code and Cursor (risk R1), not only at the end.

### Task 8: `list_changed` push and abort

- **Purpose:** A9 and A10; replaces "no push" from the earlier version (review B9, B10).
- **Files:** `server/mcp/notify.ts`, `server/mcp/handler.ts`.
- **Steps:**
  1. **Handler per user** (confirmed 2026-11-04): `Map<userId, McpHandler>`; the handler is created on the user's first request and disposed of via `close()` after idling (e.g. 10 min without an open stream). `notifyToolsChanged(userId)` calls `notify` of exactly this handler (only its streams). Variant B (one handler, `bus` filters by `userId`) only if the spike shows that `bus` allows this cleanly; the bus/`notify` API is known from the type definitions, details unverified.
  2. `subscriptions/listen`: the stream is opened after the gate (token and additional check as usual). Since there is no per-request check afterwards, there are two safeguards: (a) maximum run time of the stream = access token TTL (300 s; then close, the client reconnects and passes the gate; implementation in the wrapper, assumption), (b) `closeUserStreams(userId)` on revocation of consent/client/PAT and on ban (the ban hook belongs to phase 1 `user-lifecycle.ts`; 0b provides the function and calls it from its own revocation paths).
  3. Limit `maxSubscriptions` per handler (set the value in the spike).
  4. **Abort over HTTP = close the stream:** the `AbortSignal` of the request (the client closes the response stream) is passed through into `ToolSource.callTool(..., { signal })`. `notifications/cancelled` now applies only on stdio (phase 1) and for 2025 legacy clients, not as the HTTP abort semantics of the 2026 spec.
- **Check:** (a) SDK client v2 holds `subscriptions/listen`, `toggle_tool` triggers `tools_list_changed`; a second user with an open stream sees nothing; (b) after revocation or expiry of the maximum run time the stream is closed; (c) `slow_echo` is aborted by connection abort, `ToolSource` sees `signal.aborted`; (d) 2025 client: no push, the next `tools/list` shows the change.
- **DoD:** A9 and A10 met; tenant isolation tested.

### Task 9: Automated tests (flow, policy, endpoint)

- **Purpose:** A3 and regression protection. Details in section 6.
- **Files:** `tests/integration/oauth/*.test.ts`, `tests/integration/mcp/*.test.ts`, `tests/integration/api/*.test.ts` (shape tests, scenarios 15 and 16), `tests/unit/dcr-policy.test.ts`, `tests/helpers/oauth-client.ts`.
- **Steps:** build helpers, write tests (first red against missing parts), hook into the CI matrix from 0a (`pglite` and `postgres`). Switch on rate limits in a separate test run (E16).
- **DoD:** all tests green on PGlite and Postgres.

### Task 10: Manual acceptance with Claude Code and Cursor

- **Purpose:** A1 and A2 with real clients. Procedure in 6.3. **Prerequisite:** the frontend pages `/login`, `/register`, `/consent`, `/settings/connections`, `/settings/tokens` stand against the real routes (frontend plan, state "after 0b"); otherwise this task is postponed, A3 stays unaffected.
- **DoD:** log (date, client version, result, observations) in `docs/manual-tests/phase-0b.md`; deviations noted as issues/risks.

### Task 11: Cleanup and handover to phase 1

- **Purpose:** fix interfaces, docs.
- **Steps:** check section 10 against the code; README section "Connecting a client" (Claude Code command, PAT variant: `claude mcp add --transport http mcpwarden <url> --header "Authorization: Bearer <pat>"`; per the Claude Code docs a set Authorization header does not use OAuth); collect spec differences as a change proposal for `spec.md` v0.4 (do not change it yourself): SDK name v2, stateless/no session ID, `list_changed` via `subscriptions/listen` (2025 without push), HTTP abort = close stream (P0-14), CIMD, P0-3 in 0b, the loopback warning stems from the MCP spec, admin scope separately deselectable (phase 2), audit visibility (users own, admin additionally instance events).
- **DoD:** plan sections 2 and 3 updated with real findings; `shared/api-types.ts` covers all routes from 4.1 and the frontend is informed about the final states (deviations from 4.1 carried over in the same commit); no TODOs without an entry in 7/8.

## 6. Test strategy

The basis is the harness from 0a (folder `tests/`): the built artifact `.output/server/index.mjs` as a child process on a free port, `TEST_BACKEND=pglite|postgres`, `TEST_PG_ADMIN_URL`, fresh DB per run, default test values for `BASE_URL=http://localhost:<port>`, `BETTER_AUTH_SECRET`, `MASTER_KEY`. No second harness, no `@nuxt/test-utils`. Rate limit off via the test switch (E16), on in a separate run. Users: the first user via sign-up (becomes admin), further ones (user B, non-admin) via `createUser()` of the admin plugin, because registration is locked afterwards.

### 6.1 Automated: OAuth flow test (Vitest)

`tests/helpers/oauth-client.ts`: a small fetch-based client that simulates browser and MCP client: PKCE (S256), `state`, `resource` parameter, cookie jar, no browser. Deliberately not the SDK client for the protocol steps, so that every HTTP stage stays checkable.

Scenarios (each its own test):

1. **Happy path:** `POST /mcp` without token → 401, header contains `resource_metadata`; protected-resource metadata → AS metadata → DCR → login (fixture) → `/oauth2/authorize` (with `resource`) → redirect to login/consent → consent → redirect with `code` and `iss` → token request with `code_verifier` and `resource` → `POST /mcp` `tools/list` contains `dummy__echo` → `tools/call` echo → result is correct.
2. **PKCE required:** authorize without `code_challenge` or with `plain` → error; wrong `code_verifier` → `invalid_grant`.
3. **Redirect URI exact:** deviating URI → error without redirect.
4. **Code single use:** a second exchange of the same code fails.
5. **Refresh:** exchange → new pair; old refresh token again → rejection (replay detection; account for the `refreshTokenReuseInterval` of 30 s).
6. **Audience:** token with a different `aud` (register a second resource or sign manually) → 401; request without `resource` → defined behavior per assumption 7.
7. **Immediate revocation** (each with a still-valid JWT, without waiting): (a) revoke consent → next `/mcp` request 401; (b) client disabled → 401; (c) user banned → 401; (d) **only revoke refresh token (RFC 7009), consent stays → 401**; (e) refresh token cannot be exchanged any more after revocation; (f) PAT after revocation or ban → 401.
8. **Scopes:** token without `mcp:tools` → 403 `insufficient_scope`.
9. **DCR policy:** `off` → registration rejected; `allowlist` → Claude-Code-like request (`name`, `redirect_uris: ["http://127.0.0.1:53124/callback"]`) ok, `http://evil.example/cb` rejected, unknown name with a loopback URI rejected (name **and** URI pattern must match); `open` → everything admissible ok, `allowlisted=false` in `oauth_client_meta`; a direct call of the plugin route is filtered too; the rate limit kicks in after the threshold.
10. **Consent data:** `consent-info` reports `allowlisted:false` for an unknown client, `true` for a listed one; `loopback` for a loopback redirect; `scopes` contain `mcp:tools` (`required:true`) and never `mcpwarden:admin`; invalid signature → 400 `invalid_consent_query`; without session 401.
11. **Admin access:** admin routes under `/api/admin/oauth/*`: anonymous 401, user B (not admin) 403, admin 200.
12. **Origin:** `Origin: https://evil.example` → 403; without `Origin` ok; origin from `ALLOWED_ORIGINS` ok.
13. **PAT:** create (plaintext only in the POST response, prefix `mcpw_pat_` + 4 characters), use, `last_used_at` set, revoke → 401; user B can neither see nor revoke the PAT of A (404).
14. **Isolation/leak:** unauthenticated requests (`tools/list`, `initialize`) deliver no tool name in the body.
15. **Shape tests of the routes (contract):** for each route from 4.1 a test checks the key set and value types of the response (among others ISO-8601 timestamps, `null` instead of missing fields, `expiresAt` rule, `limit.max` 20, prefix length 13) and the error body (`data.code`). Compile time: `satisfies` against `shared/api-types.ts`. Canary: no secret field in any response except `PatCreated.token`.
16. **The user's clients:** `GET /api/me/connections` shows `lastUsedAt` after a `/mcp` call (tolerance 1 min because of throttling) and `active:true`; without a call `lastUsedAt:null`, `active:false`; revoke → 204, afterwards 401 on `/mcp` and 404 on the second revoke.

### 6.2 Automated: protocol tests with the SDK client

- `@modelcontextprotocol/client` (v2) with a bearer PAT against `/mcp`: `listTools`, `callTool` for `echo`, `add` (argument error → error result), `whoami`. Read out and log the protocol version in the test. A second run forces the legacy path (2025-11-25 with `initialize`) if the client lets a version be forced (option unverified; otherwise manual).
- **Push (A9):** SDK client v2 with an open `subscriptions/listen` for user A, a second client for user B; `toggle_tool` for A → only A gets `tools_list_changed`. Check the stream closing on revocation and maximum run time.
- **Abort (A10):** `callTool('slow_echo')` with `signal`; `abort()` → `ToolSource` sees `signal.aborted`. For the legacy era (`notifications/cancelled`) 0b has only the stdio-less HTTP path, so the connection abort suffices.
- The SDK client with the OAuth provider interface as a complete run is desirable but **unverified** regarding the API; only if feasible without great effort.

### 6.3 Manual: acceptance with Claude Code and Cursor

Preparation: `BASE_URL=http://localhost:3000`, fresh DB, admin user registered, DCR mode `open`.

1. Claude Code (note the version, ≥ 2.1.231 because of the callback fix per docs): `claude mcp add --transport http mcpwarden http://localhost:3000/mcp`.
2. In Claude Code `/mcp` → `mcpwarden` → authenticate. Expectation: the browser opens `/login`, then consent. A warning is visible if Claude Code does not match in the allowlist; otherwise none. Note both.
3. Status "connected"; `/mcp` lists `dummy__echo`, `dummy__add`, `dummy__whoami`.
4. Prompt: "Call the echo tool with 'hallo'" → result; `whoami` shows token type `oauth`, user ID and role.
5. Revoke: page "Clients" (`/settings/connections`) → revoke Claude Code; further tool call → error/re-auth (expected 401 on the next request). Variant: revoke the refresh token alone (via API), same effect.
6. Mode test: DCR mode `off`, `claude mcp remove` and add again → clean error message (note the content; the fallback to CIMD/pre-config fails without CIMD).
7. PAT variant: create a PAT, `claude mcp add --transport http mcpwarden-pat http://localhost:3000/mcp --header "Authorization: Bearer <pat>"`; tools visible; revoke the PAT → error.
8. **Cursor (mandatory client, O1):** `mcp.json` `{"mcpServers": {"mcpwarden": {"url": "http://localhost:3000/mcp"}}}` (format unverified, check against the Cursor docs), go through OAuth, call `echo`. Note the redirect scheme (`cursor://` or loopback) and version; check the tool list after `toggle_tool` (push depending on the client's protocol revision). Fallback MCP Inspector (`npx @modelcontextprotocol/inspector`, Streamable HTTP with OAuth, feature scope unverified) only with a demonstrated Cursor problem.
9. Optional: tunnel with HTTPS, `BASE_URL` to the tunnel host, Claude Desktop/Web as a custom connector; adopt callback URLs into the allowlist (otherwise phase 1.4).

Acceptance log: table client × version × protocol revision × result × observations.

## 7. Risks

| Risk | Effect | Countermeasure |
|---|---|---|
| R1: The 2026-07-28 spec/SDK v2 are new; Claude Code or Cursor may still speak 2025-11-25 with `initialize` and expect session behavior (GET SSE, `Mcp-Session-Id`) | Connection fails or no push for these clients | Test the stateless legacy path (default); connect real clients early (task 7); on problems estimate a sessionful variant with `isLegacyRequest` routing |
| R2: JWT access tokens are not revocable server-side | "401 on the next request" missed | Short TTL plus DB check on every request incl. refresh token state (task 6) |
| R3: The DCR policy takes effect only if `/oauth2/register` can be intercepted | Policy can be bypassed | `clientPrivileges`/hook (spike), Nitro middleware as fallback; test of the direct call of the plugin route |
| R4: Allowlist matching by name is forgeable | "Allowlisted" deceives | Name **and** redirect pattern must match; the consent always shows the redirect host; the allowlist is convenience/warning logic |
| R5: Loopback redirect impersonation | Phishing of a code | Always show the redirect host, extra warning for loopback, PKCE required, short code lifetime |
| R6: Claude Code redirect URI `127.0.0.1` vs `localhost` (bug in v2.1.229 per docs) | Exact matching fails | Both loopback forms with any port in the allowlist; version in the log |
| R7: Token without `resource` stays opaque or without a matching `aud` | Audience binding does not work for some clients | Assumption 7, test 6.1-6, enforce a default resource or reject |
| R8: Wrong issuer/resource URLs behind a reverse proxy | Clients reject metadata | URLs only from `BASE_URL`; test with `X-Forwarded-*` that are ignored |
| R9: PGlite single connection and additional query per request | Latency, locks | Short single queries, no transactions; measure overhead (target ≪ 50 ms) |
| R10: Plugin path changes (`@better-auth/*` v1.7.x young) | Breaking changes | Pin versions exactly; flow test as protection |
| R11: Long-lived `subscriptions/listen` streams bypass the per-request check | A revoked user stays connected | Maximum run time = token TTL, `closeUserStreams` on revocation, `maxSubscriptions` (task 8) |
| R12: Handler per user: memory/count with many users | Resource consumption | Idle disposal, single-instance target (few users); variant B (bus filter) as an alternative |
| R13: CIMD becomes the default path of the clients (DCR "fallback only") | CIMD-only clients cannot register | Observe; `@better-auth/cimd` with the same allowlist as a follow-up task |
| R14: Consent redirect depends on details of the Better Auth client plugin; `/login` from 0a must preserve the signed query | Effort in the frontend | Spike in task 1/4, follow the example of the docs |
| R15: The refresh token check does not apply to clients without `offline_access` | Single-token revocation not immediate there | **Decided (part 1): `offline_access` is a required scope.** The consent always offers `openid offline_access mcp:tools` and requires all; the guard requires a living refresh token for every OAuth token (tests green). Open (spike, waiting for 0a): whether the plugin can add `offline_access` on authorize; otherwise reject clients without `offline_access` with a clear error and document it. |
| R16: Schema migrations from parallel branches collide in the journal | Migration errors | Strictly sequential 0000 → 0001 → 0002 → phase 1; `db:check` in CI |

## 8. Unverified (collection)

Not confirmed against official sources: status of the old `mcp` plugin in `better-auth/plugins`; effect of `clientPrivileges` on anonymous DCR and existence of an open `before` hook for `/oauth2/register`; returning a (streamed) web `Response` from the h3 1.15 handler; whether `@better-auth/oauth-provider` comes along automatically; claims in the JWT (`sid`, `azp`) and behavior without `resource`; refresh token schema and behavior for clients without `offline_access`; Claude web callback URLs; Cursor `mcp.json` format and redirect scheme; MCP Inspector OAuth function; whether Claude Code/Cursor speak 2026-07-28 today; SDK `ctx.authInfo` mapping in the factory; details of `bus`/`notify`/`maxSubscriptions` and whether a maximum run time of the streams can be set cleanly; whether `subscriptions/listen` runs over POST; name of the rate-limit test switch (0a); maturity of Nitro `scheduledTasks`; Claude Code version with the callback fix other than the state named in the docs (≥ 2.1.231).

## 9. Not in 0b

**All Vue files under `app/**`** (frontend; in particular consent page, DCR admin page, token and clients pages, layouts, middleware), dashboard, statistics and audit routes, device/device-name fields, an effective admin scope (`mcpwarden:admin` comes in phase 2, including separate deselecting in the consent), real upstreams, tool filter, rate limits (except DCR/auth endpoints of Better Auth), stdio, REST tools, management tools (`mcpwarden:admin` scope content), **audit log** (`audit_log`/`audit()` is created by phase 1; in 0b only one logger line per request without contents; logger with redaction likewise phase 1), invitations/allowlist for users, user list, delete/ban UI and `user-lifecycle.ts` (phase 1, milestone 1.1; on ban/delete 0b acts only via the access check), CIMD, sessionful MCP, profiles (`/mcp/:profile`), PGlite → Postgres switch test (phase 1).

## 10. Interfaces for phase 1

**Auth context per request** (`server/auth/auth-context.ts`). The type is uniformly called `AuthContext` (replaces `GatewayAuth` from the phase 1 plan; field name `tokenType`, not `kind`; `role` is added, review decision). It is created by the gate and passed to every tool handler (in the SDK as `authInfo.extra`, access via `getAuthContext(ctx)`); for routes outside the SDK handler there is `authenticateMcpRequest(request): Promise<AuthContext | Response>` in `server/auth/access-guard.ts` (replaces `requireGatewayAuth`):

```ts
export type AuthContext = {
  userId: string;                  // user.id from Better Auth (text); basis of every query (tenant isolation)
  role: 'admin' | 'user';          // from the user row of the access check
  tokenType: 'oauth' | 'pat';
  tokenId: string;                 // oauth: token/consent reference (jti or consent ID), pat: PAT ID
  clientId: string | null;         // oauth: OAuth client_id, pat: null
  clientName: string | null;       // for audit/statistics (untrusted, truncated)
  scopes: string[];                // e.g. ['mcp:tools'], later 'mcpwarden:admin'
  expiresAt: number | null;        // Unix seconds; PAT: null
  resource: string;                // BASE_URL + '/mcp' (later profile path)
};
```

Contracts for phase 1:

- Every database query takes `ctx.userId`; no handler reads a user ID from request parameters. `decryptSecret` gets the `userId` from the context, never from the row.
- Data access via `getDb()`, auth via `getAuth()` (both async), session helpers `requireUser`/`requireAdmin`; tables without prefix; settings in `app_setting` (key `oauth.dcr_mode` taken by 0b).
- The scope check runs in the gate (403 `insufficient_scope`); scope name `mcp:tools`; phase 2 adds `mcpwarden:admin` to `scopes` and `scopes_supported`.
- **`ToolSource`** (`server/mcp/upstream-port.ts`) is the swap point for the real upstream registry (names `<upstream>__<tool>`): `listTools(ctx)` and `callTool(ctx, name, args, { signal })`. Phase 1 implements the interface and builds no `createGatewayServer` of its own; the MCP handler stays in `server/mcp/handler.ts`.
- **Push:** `notifyToolsChanged(userId)` and `closeUserStreams(userId)` from `server/mcp/notify.ts`. Phase 1 calls `notifyToolsChanged` on disable/toggle of tools and upstreams, `closeUserStreams` from `user-lifecycle.ts` on ban/delete. 2025 clients receive no push (accepted).
- **Abort:** over HTTP, closing the response stream is the abort; the `AbortSignal` in `callTool` is authoritative. Phase 1 tests per era (HTTP-2026 → fake upstream sees the connection abort; legacy/stdio → `notifications/cancelled`).
- Gate order fixed: origin → method → token → additional check → MCP handler. The origin check lies in 0b; phase 1 task 1.2.1 is dropped. Phase 1 hangs rate limit per token (`tokenId`) and statistics (`clientId`, `tokenId`) between the additional check and the handler.
- Banning a user takes effect immediately for OAuth tokens and PATs via the additional check; phase 1 builds the admin UI and `user-lifecycle.ts` (invitations, user list, ban, delete) on `user.banned`/`admin()` from 0a.
- Statelessness: there is no gateway session; pooled upstream client sessions (phase 1) hang off `(userId, upstreamId)`, not off an MCP session ID.
- Audit: `audit_log` and `audit()` are created by phase 1; 0b has only the logger line per request. Boundary condition for the read route in phase 1 (confirmed 2026-11-04): users see only their own entries, admins additionally instance events (user banned, setting changed).
- Frontend contract: the routes and types from 4.1 are part of the interface. Phase 1 uses the same error shape (E19) and extends `shared/api-types.ts` without renaming or removing existing 0b fields. `ConnectionSummary.active` (status word "Aktiv") and `lastUsedAt` remain the source for the clients table of the dashboard.
- Open for phase 1: the dashboard empty-state frontend needs the MCP URL (`BASE_URL + '/mcp'`); `ConsentInfo.resource` delivers it only in the consent case. Proposal: field `mcpUrl` in `GET /api/me/capabilities` (phase 1).
- Migrations: 0001 and 0002 come from 0b, phase 1 starts at 0003.

## 11. Findings part 1 (implementation without 0a, 2026-11-04, Node 24.13, `@modelcontextprotocol/server`/`client` 2.4.0)

Evidenced by `tests/unit/mcp-gateway.test.ts` (real HTTP server, SDK client v2):

- `createMcpHandler(factory, { legacy: 'stateless' })` serves 2025-11-25 (client `mode: 'legacy'`, `initialize`, without session ID) and 2026-07-28 (`mode: 'auto'`) at the same endpoint. The gate answers GET/DELETE with 405.
- `authInfo` arrives in the factory as `mctx.authInfo` (value from `handler.fetch(request, { authInfo })`); the `AuthContext` travels in `authInfo.extra`. The abort reaches `ctx.mcpReq.signal` if the web `Request` carries a `signal` (closing the response stream); A10 evidenced at this level.
- `handler.notify.toolsChanged()` reaches only listen streams of its own handler; with one handler per user tenant isolation is evidenced (A9). A 2025 client receives no push. `client.listen()` runs only on 2026 connections.
- The maximum run time of the listen streams is enforced in the wrapper (`limitStream`); `closeUserStreams` = `handler.close()` plus discarding the handler. The body must be evaluated before `handler.fetch` (consumed afterwards).
- The SDK's origin/host helpers compare only host names (port-agnostic); a missing `Origin` passes, `null`/unparseable becomes 403.
- Open, waiting for 0a: a streamed web `Response` from the h3 handler in the built Nitro, binding to `requireMcpAuth`/`verifyAccessTokenRequest`, all spike questions from task 1.
