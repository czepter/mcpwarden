# Phase 0a (foundation): implementation plan

As of: 2026-11-04 (revised after `docs/plans/review.md`; frontend responsibility incorporated per `docs/ui-comparison.md` and `docs/plans/frontend.md`) · Basis: `docs/spec.md` v0.3 (phases, P0-11, P0-10, P0-4, technical constraints); interfaces per the reconciliation table in the review

Language: this document is English; the product UI is German by decision.

## 1. Goal and acceptance criteria

Goal: a sound data and auth layer (including role/ban via the `admin()` plugin) on which 0b (OAuth provider) and phase 1 (gateway, user management) build. No gateway, no upstreams, no OAuth provider.

**Responsibility (confirmed 2026-11-04):** the frontend agent builds **all Vue files under `app/**`** (pages, layouts, components, Tailwind and shadcn-vue setup, login and registration page). 0a delivers only `server/**`, tests, configuration, tooling, the Nuxt scaffold with a placeholder `app.vue` and contributions to the contract `shared/api-types.ts`. Details and the milestone "scaffold ready" in section 3.

Acceptance (all automated, see section 6):

- [ ] A1 Registration and login by email/password work against PGlite (default, `DATABASE_URL` empty). What is checked is the HTTP API (`/api/auth/*`), not a page; the pages `/login` and `/register` are built by the frontend against this API and accepted by it itself.
- [ ] A2 A restart (SIGTERM, then start again with the same `DATA_DIR`) keeps users; login with the old password works. Prerequisite: PGlite is closed cleanly on SIGTERM (Nitro `close` hook or own signal handler, spike in task 7).
- [ ] A3 The same test set is green with `DATABASE_URL=postgres://…` against a Postgres container, without code or schema change (`pnpm test:pg`, CI matrix).
- [ ] A4 Migrations run idempotently at startup (second start: no error, no new migration).
- [ ] A5 The app does not start without a valid `MASTER_KEY`, `BETTER_AUTH_SECRET`, `BASE_URL` (exit code ≠ 0, clear message without key contents).
- [ ] A6 The Better Auth schema (including `admin()` columns) is generated from Better Auth (not by hand), the migrations are checked in, CI checks via `db:schema && db:generate && db:check && git diff --exit-code` that both match the state.
- [ ] A7 All DB accesses go through exactly one client per process (test: parallel requests against PGlite without errors).
- [ ] A8 No request sees an unmigrated DB: a race test (requests immediately after process start) never yields a schema error; `getDb()` resolves only after the migration (B1).
- [ ] A9 The first registered user has `role=admin`; parallel first registrations yield exactly one user (rest 403); afterwards public registration is locked; further test users arise via the admin API (B2, B3). `get-session` returns `role` and `banned`.
- [ ] A10 "Scaffold ready": task 1 is finished and delivers exactly the files from section 3.1, so that the frontend can start without asking back (`pnpm install && pnpm build` green, alias `#shared/api-types` resolves in `app/` and `server/`).

## 2. Checked versions and assumptions

Versions checked on 2026-11-04 via `npm view` (registry) and official docs (nuxt.com, better-auth.com, orm.drizzle.team, pglite.dev, shadcn-vue.com); the versions were confirmed in the review (S13).

| Package | Version (latest) | Remark |
|---|---|---|
| nuxt | 4.6.4 | Nitro 2 (`nitropack ^2.13.6` via `@nuxt/nitro-server`), h3 v1 (`^1.15.11`). Engines: `^22.22.3 \|\| ^24.15.0 \|\| >=26`. Locally Node 24.13.0 is installed, i.e. too old: raise to >= 24.15. |
| better-auth | 1.7.17 | The Drizzle adapter is its own package `@better-auth/drizzle-adapter` 1.7.17 (peer: `drizzle-orm ^0.45.2 \|\| >=1.0.0-rc.1`). |
| auth (CLI) | 1.7.17 | `pnpm dlx auth@1.7.17 generate`; the older `@better-auth/cli` (1.4.21) is outdated, do not use. |
| drizzle-orm | 0.45.4 (stable) | Dist tag `rc` = 1.0.0-rc.5. Decision: **pin 0.45.x**, 1.0 only after release. |
| drizzle-kit | 0.31.11 (stable) | analogous to drizzle-orm. |
| @electric-sql/pglite | 0.5.15 | Path `dataDir` as a string (Node: file system), `PGlite.create(dataDir)` waits for ready. Single exclusive connection per docs. |
| pg | 8.23.1 | Driver for real Postgres (`drizzle-orm/node-postgres`). |
| tailwindcss, shadcn-nuxt, shadcn-vue and further UI packages | – | **no longer part of 0a**: setup and versions are handled by the frontend (`docs/plans/frontend.md`, section 2). |
| vitest | 5.1.0 | The better-auth peer allows `^5`; `@nuxt/test-utils` 4.3.4 allows `^4 \|\| ^5` per peer (review S6). Still no `@nuxt/test-utils`: one harness for all phases (section 6). |
| typescript | **5.9.x (or 6.x)** | **Decision (review B20):** pin TS 5.9/6.x. `vue-tsc` 3.3.14 requires only `>=5.0.0`, TS 7.0.2 is unverified with `nuxi typecheck`; switching to 7 later as its own task. |

Verified in the docs:
- Drizzle + PGlite: `import { drizzle } from 'drizzle-orm/pglite'`, `drizzle({ client })` with an own `PGlite` client; migrators exist as `drizzle-orm/pglite/migrator` and `drizzle-orm/node-postgres/migrator` (present in package 0.45.4).
- Better Auth Nuxt: handler `server/api/auth/[...all].ts` with `auth.handler(toWebRequest(event))` (`toWebRequest` is the right way, review S5), client via `better-auth/vue`, page middleware with `return navigateTo(...)`, session server-side via `auth.api.getSession({ headers })`.
- Better Auth options: `BETTER_AUTH_SECRET` is read, in production an error without a secret; `baseURL`, `trustedOrigins`, `rateLimit` (default active only in production, storage `memory`/`database`), `advanced.ipAddress.ipAddressHeaders`/`trustedProxies`, `databaseHooks.user.create.before`, `hooks.before` (`createAuthMiddleware`).
- Schema generation: `pnpm dlx auth@1.7.17 generate --config <path> --output <file> --adapter drizzle --dialect postgresql -y`. Without `--config` the CLI searches `auth.ts` in `./`, `./lib`, `./utils` (also under `src`). The Drizzle schema needs no live DB. `admin()` adds `role`, `banned`, `ban_reason`, `ban_expires` (review S3). The CLI config needs a valid `baseURL` (review B12).

Settled or decided by the review:
- **U1 settled (verified):** `--dialect postgresql` (mapped to `pg` for Drizzle; `auth generate --help`, review S2, 2026-11-04). Generated schema: `id text`, columns explicitly snake_case (`email_verified`, `user_id`), hence no `casing` flag.
- **U2 settled (verified in the spike, without Nuxt):** spike in the review's scratchpad (2026-11-04, Node 24.13, better-auth 1.7.17 + `@better-auth/drizzle-adapter` 1.7.17 with `provider: 'pg'` + drizzle-orm 0.45.4 + PGlite 0.5.15): sign-up 200, sign-in 200, 30 parallel `getSession` ok, `migrate()` twice yields 1 entry in `drizzle.__drizzle_migrations`, restart with the same `dataDir` ok (review S1). **Not checked:** a run inside Nuxt/Nitro and in the built artifact; this is repeated in task 5/7 (see spike below), in case of deviation the Nuxt build finding applies.
- **U4 refuted:** Nitro (`nitropack@2.13.6`, `runNitroPlugins`) calls plugins without `await`; asynchronous plugins run concurrently with the first request (review S4, B1). Consequence: init as a once-memoized promise in `getDb()`, `getAuth()` waits for it, the plugin only kicks it off (task 4, 7).
- **U6, U7:** as before, see below.

**Still unverified** (handled in the respective task as a spike with a termination criterion):
- U3 Whether an error thrown in a Nitro plugin ends the process (hence explicit `process.exit(1)` in the `.catch` of the kicked-off promise).
- U5 Rule path format of `rateLimit.customRules` (`/sign-in/email`).
- U6 Behavior of PGlite on SIGKILL (durability); only a clean shutdown is tested.
- U7 Whether the CLI loads the config with TS path aliases (`~~/`); the plan avoids aliases in `auth.cli.ts` (relative imports).
- U8 Whether Nitro calls the hook `close` on SIGTERM (for a clean `closeDb()`, A2). Fallback: own `process.on('SIGTERM')` handler in the init plugin that calls `closeDb()` and then exits.
- U9 Whether a `databaseHooks.user.create.before` also fires on `auth.api.createUser` (admin plugin), or whether the lock belongs instead in `hooks.before` on the path `/sign-up/email` (the plan assumes the latter, see task 8).
- U10 Whether a hook may set the role `admin` for the first user (return `{ data: { …user, role: 'admin' } }` in the `before` hook) or whether the `admin()` option `adminUserIds` or similar is needed.

Assumptions:
- Package manager pnpm, Node >= 24.15 (`.nvmrc`, `engines`). Branch `feat/phase-0a-foundation`, `git init` is part of task 1; push only after the complete stack (project rule), nothing committed in this assignment. The frontend agent (branch `feat/frontend`) branches off the scaffold commit from task 1 (section 3.1); both work in the same local repository (assumption, e.g. separate worktrees), the scaffold commit does not need to be pushed for that.
- Vue/UI responsibility: see sections 1 and 3. 0a writes under `app/` only `app/app.vue` (placeholder); everything else is exclusively the frontend's.
- No dark mode work in 0a (confirmed 2026-11-04); also no `@nuxtjs/color-mode`.
- Minimum password length 12 characters, enforced server-side (Better Auth option `emailAndPassword.minPasswordLength: 12`, spec P0-4; check the option against the docs before use). Test: registration with 11 characters is rejected with 400.
- No mail functions: no mail sending, no password reset mail, no email verification, no email change, no account self-deletion (confirmed 2026-11-04). Task 5 does not switch on the corresponding Better Auth options.
- No Dockerfile in 0a (P0-10 belongs to phase 1). But 0a delivers the preconditions: migrations folder in the build output, writable `DATA_DIR`, `/healthz`.
- CI is GitHub Actions (`.github/workflows/ci.yml`); if another host, adjust only task 12.
- Configuration via `process.env` (not `NUXT_*` runtimeConfig, also not `runtimeConfig` in `nuxt.config.ts`), because the ENV names from the spec are fixed (interface decision of the review: 0a variant, 0b E1 is dropped).
- Schema changes strictly sequential (0a → 0b → phase 1), no parallel migrations from branches (drizzle-kit journal collides, review B23); `db:check` is mandatory in CI.
- Migration order per review: `0000` (0a, including `admin()`), `0001` (0b OAuth tables), `0002` (0b own tables), from `0003` phase 1. Names are assigned by drizzle-kit, tables **without prefix**.

Open points (review recommendation adopted as a requirement):
- O1 **confirmed 2026-11-04:** registration in 0a **locked after the first user**, secured by a process-wide mutex (B3); the first user gets `role=admin`. Invitations, user list, ban, delete and `user-lifecycle.ts` follow in phase 1, milestone 1.1. **The invitation will be a token link** (`/invite/<token>`, valid 7 days, optionally bound to an email; confirmed 2026-11-04, replaces the email allowlist). In 0a this concerns only the lock: the decision "may someone register" sits behind exactly one function `canRegister()` (task 8), which phase 1 extends with the token check without rebuilding the hook or the mutex. How the token reaches the lock (field in the sign-up body or own accept endpoint) is decided by phase 1; 0a does not commit to it.
- O2 **confirmed 2026-11-04:** location of the admin functions: `admin()` plugin, role/`banned` in the schema, `requireAdmin` in 0a; user management in phase 1 1.1 (B2).
- O3 OAuth provider tables: 0a generates only the core schema plus `admin()` (user, session, account, verification; `role`, `banned`, `ban_reason`, `ban_expires` on `user`). The tables of `mcp()`/`jwt()` (jwks, oauth_client, oauth_resource, oauth_client_resource, oauth_refresh_token, oauth_access_token, oauth_consent, oauth_client_assertion) come in 0b as migration 0001. This is possible later (review S3, recommendation "yes").
- O4 The PGlite → Postgres switch test (P0-11) belongs per the review (B4) to **phase 1** and is **not** part of the 0a acceptance. The Postgres container test of the login acceptance (A3) stays in 0a. What 0a must deliver for the switch test is in section 8 (handover). Note: `dumpDataDir()` returns a tarball, not SQL; `pgDump` from `@electric-sql/pglite-tools` 0.4.15 produces an SQL dump with data (review S11, import into Postgres not yet tested).
- O5 **confirmed 2026-11-04:** an additional test switch `RATE_LIMIT=off` (default: on) in the ENV list, because the build has `NODE_ENV=production` and the Better Auth rate limit would otherwise hit the tests with 429 there (B16). Must be included in spec v0.4 (P0-10); `STDIO_MODE` and `TRUST_PROXY` belong to phase 1 and are not part of 0a.
- O6 **confirmed 2026-11-04:** TypeScript 5.9.x instead of 7.x (B20); the TS 7 switch as its own task later.

## 3. Directory structure (to be created)

```
mcpwarden/
├── .nvmrc                          # 24 (>= 24.15)
├── .gitignore                      # node_modules, .nuxt, .output, data/, .env
├── .env.example                    # all six spec ENV names plus RATE_LIMIT (test), without real values
├── package.json                    # scripts, engines, pinned versions
├── nuxt.config.ts                  # SHARED, separate blocks (section 3.2): here the 0a block with nitro preset node-server, migrations copy hook
├── tsconfig.json                   # Nuxt default (extends .nuxt/tsconfig.json)
├── eslint.config.mjs               # base configuration (task 1); the frontend adds rules only for app/**
├── drizzle.config.ts               # dialect postgresql, schema, out
├── compose.test.yaml               # Postgres only for tests (no app compose, that is phase 1)
├── .github/workflows/ci.yml        # (the frontend has its own file ui.yml)
├── shared/
│   └── api-types.ts                # SHARED CONTRACT: 0a creates an empty skeleton (task 1), rules section 3.3
├── app/
│   └── app.vue                     # placeholder only (task 1); everything else under app/ belongs to the frontend
├── server/
│   ├── api/auth/[...all].ts        # sign-up requests run in the mutex
│   ├── routes/{healthz,readyz}.get.ts
│   ├── plugins/00-init.ts          # kicks off getDb(), fail fast, shutdown hook; further plugins from 10-…
│   ├── utils/
│   │   ├── config.ts               # getConfig()
│   │   ├── master-key.ts           # getMasterKey()
│   │   ├── mutex.ts                # process-wide promise-chain mutex (sign-up)
│   │   └── session.ts              # requireUser(event), requireAdmin(event)
│   ├── db/
│   │   ├── index.ts                # getDb() (init promise incl. migration), closeDb(), type Db, dbBackend
│   │   ├── migrate.ts              # runMigrations(db)
│   │   ├── schema/index.ts         # re-export
│   │   ├── schema/auth.ts          # GENERATED from Better Auth (incl. admin())
│   │   └── migrations/             # drizzle-kit output, checked in
│   └── auth/
│       ├── options.ts              # buildAuthOptions(cfg): plugins (admin), fields, hooks (without DB)
│       ├── registration.ts         # canRegister(): the one place of the registration lock (phase 1: token invitation)
│       ├── index.ts                # getAuth() (async, memoized, waits for getDb())
│       └── auth.cli.ts             # only for `auth generate`, sets baseURL
├── scripts/
│   ├── init-env.sh                 # creates a local .env from .env.example with random values (task 1)
│   ├── gen-auth-schema.sh          # auth generate, deterministic
│   └── wait-postgres.sh            # optional, in case `--wait` in the healthcheck is not enough
└── tests/
    ├── unit/{config,master-key}.test.ts
    ├── integration/
    │   ├── global-setup.ts         # choose backend, temp DATA_DIR or fresh Postgres DB
    │   ├── harness.ts              # startServer(env), stopServer(), api(), signUpFirstAdmin(), createUser()
    │   ├── auth.test.ts            # A1, A7, A9
    │   ├── restart.test.ts         # A2, A4
    │   ├── startup-race.test.ts    # A8
    │   └── startup-checks.test.ts  # A5
    └── vitest.config.ts
```

The test folder is `tests/` (review decision; 0b and phase 1 adopt the harness and the variables `TEST_BACKEND`, `TEST_PG_ADMIN_URL`). `tests/unit`, `tests/integration` and `tests/vitest.config.ts` belong to the backend; the frontend's UI tests live separately under `tests/ui/**`.

### 3.1 Milestone "scaffold ready" (end of task 1)

Task 1 runs **before everything else** and ends with a commit of its own on `feat/phase-0a-foundation` (subject e.g. `chore: nuxt scaffold`). From this commit on the frontend may start and branches off from it. Tasks 2 to 12 are **not** needed for that. Task 1 delivers exactly these files, no more:

| File | Content | Afterwards |
|---|---|---|
| `package.json` | `name`, `private`, `type: module`, `packageManager` (pnpm), `engines.node`, pinned versions of `nuxt`, `vue`, `typescript` (5.9.x), `vue-tsc`, ESLint tooling; scripts `dev`, `build`, `preview`, `typecheck` (`nuxi typecheck`), `lint` | shared; the frontend adds own dependencies and scripts with prefix `ui:`, 0a its own (`db:*`, `test*`) |
| `pnpm-lock.yaml` | matching the scaffold | shared, conflicts on rebuild |
| `nuxt.config.ts` | `compatibilityDate`, `devtools`, `nitro: { preset: 'node-server' }`; two commented blocks `// --- Backend (0a) ---` and `// --- Frontend ---` (the latter empty); `ssr` stays at the Nuxt default (the frontend sets it itself) | shared, rules in 3.2 |
| `tsconfig.json` | Nuxt default with a reference to `.nuxt/tsconfig.json` | 0a |
| `eslint.config.mjs` | flat-config basis (check the package choice via `npm view` during implementation, **unverified**); `lint` runs without errors | shared, the frontend adds rules for `app/**` |
| `.nvmrc`, `.gitignore`, `.env.example` | as in task 1 | 0a |
| `scripts/init-env.sh` | writes `.env` with freshly generated `BETTER_AUTH_SECRET` and `MASTER_KEY` (`openssl rand`) and `BASE_URL=http://localhost:3000`, never overwrites an existing `.env` | 0a |
| `shared/api-types.ts` | header comment with the rules from 3.3 and `export {}` | shared contract |
| `app/app.vue` | placeholder, e.g. `<template><div>mcpwarden</div></template>`; no `NuxtPage`, no styles | **the frontend replaces it** (exclusive) |
| `server/`, `tests/`, `scripts/` | folders only, as far as task 1 needs them; otherwise empty | 0a |

Not part of the scaffold: Tailwind, `@tailwindcss/vite`, `shadcn-nuxt`, `components.json`, `@nuxtjs/color-mode`, font packages, `lib/utils.ts`, every file under `app/` except `app.vue`. The frontend creates all of that.

**Acceptance of the milestone:** `pnpm install && pnpm build` green, `node .output/server/index.mjs` returns 200 on `GET /`, `pnpm typecheck` and `pnpm lint` without errors, a test import `#shared/api-types` resolves in `app/` and `server/` (alias name from the Nuxt docs, check in the repo; the test import is not checked in). Then report back to the frontend with the commit.

**Important for `ui:dev`:** in mock mode the frontend nevertheless starts the Nitro server, and `00-init.ts` (task 7) ends the process without a valid ENV (A5). Therefore the frontend runs `pnpm env:init` (calls `scripts/init-env.sh`) once before `ui:dev`; the variant of skipping `00-init.ts` in mock mode is rejected because it would make production code depend on a frontend switch. (Assumption, to be agreed with the frontend.) The script `env:init` belongs in `package.json` (0a, task 1).

### 3.2 Ownership after the milestone

| Area | Owner | Rule |
|---|---|---|
| `app/**` (including `app.vue`, layouts, pages, components, middleware, plugins, `lib/auth-client.ts`, Tailwind CSS), `components.json`, `mocks/**`, `tests/ui/**`, `public/mockServiceWorker.js`, `.github/workflows/ui.yml` | **Frontend, exclusive** | 0a and the backend phases create and change nothing there. If something is missing, make a wish to the frontend. |
| `server/**`, `supervisor/**`, `tests/unit/**`, `tests/integration/**`, `tests/vitest.config.ts`, `drizzle.config.ts`, `compose*.yaml`, `Dockerfile`, migrations, `scripts/**`, `.github/workflows/ci.yml`, `.env.example`, `.nvmrc` | **Backend (0a, 0b, phase 1)**, exclusive | The frontend changes nothing there. |
| `package.json`, `nuxt.config.ts`, `eslint.config.mjs`, `pnpm-lock.yaml`, `README.md` | shared | Everyone touches only own keys or sections, small commits. In `nuxt.config.ts` the backend owns `nitro`, `hooks` (copy hook), `compatibilityDate`, `devtools`; the frontend owns `ssr`, `modules` (only `shadcn-nuxt`, `@nuxtjs/color-mode`), `css`, `vite.plugins`, `shadcn`, `colorMode`, `app.head`. The backend creates no `runtimeConfig` keys of its own (configuration via `process.env`). In `package.json` the backend owns `engines`, `db:*`, `test*`, `env:init`, the frontend `ui:*` and UI dependencies. `README.md`: the backend writes "Development", the frontend the section "Frontend". |
| `shared/api-types.ts` | shared contract | Rules in 3.3 |

### 3.3 Contract `shared/api-types.ts`

Created by 0a in task 1 as an empty file with a header comment; the frontend creates the first version of the types (source: `docs/ui-comparison.md`, section 5). 0a contributes only the types for its own routes (task 8: `Role`, `AuthSessionUser`, `ApiErrorBody`, code of the locked registration); the frontend does not define these names again. Rules that stand as a header comment in the file:

1. Only types and constants; no runtime logic, no import of Vue or Nitro; import everywhere as `#shared/api-types`.
2. Timestamps as ISO-8601 strings, durations in milliseconds with suffix `Ms`, ratios as a number 0 to 1. Secrets appear in no response type (only `hasSecret: boolean`).
3. Adding a field is backward compatible and needs only a note in the commit subject. Renaming or removing requires prior agreement between the frontend and the backend agent of the affected route and changes type, mock (frontend) and route in the same commit.
4. Whoever builds or changes a route adds the type in the same commit and checks the response against the type with `satisfies`. Changes to the file carry the subject prefix `contract:`.
5. The backend builds no response that deviates from the type; if it deviates deliberately, the type is changed (rule 3) rather than concealing the deviation.

## 4. Tasks

The order is dependent: 1 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 11 → 12. Task 2 and task 9 are handed over to the frontend (numbers are kept because 0b and phase 1 refer to them). **Task 1 has priority** and is the milestone "scaffold ready" (section 3.1): from its completion the frontend runs in parallel to tasks 3 to 12. Released for immediate start are tasks 1, 3, 4, 5 (U1/U2 settled, review "start order"). The spike in task 7 (init promise, migration copy, SIGTERM) depends on the real Nuxt build and should run early, as soon as tasks 4/5 stand; the rate-limit decision (O5) must be made before task 10.

### Task 1: Repo and Nuxt scaffold (milestone "scaffold ready")
- Purpose: a runnable Nuxt 4 project with the Node preset on which the frontend can build. Task 1 runs first and delivers **exactly** the files from section 3.1.
- Files: `package.json`, `pnpm-lock.yaml`, `nuxt.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.nvmrc`, `.gitignore`, `.env.example`, `scripts/init-env.sh`, `shared/api-types.ts` (empty with rules), `app/app.vue` (placeholder).
- Steps:
  1. Activate Node >= 24.15; `git init`, branch `feat/phase-0a-foundation`.
  2. `pnpm create nuxt@latest` (minimal template) in the existing folder (`docs/` stays) or create the scaffold by hand; afterwards remove all files that are not in section 3.1.
  3. Pin versions exactly (table section 2), **TypeScript 5.9.x**; set `engines.node`. Scripts `dev`, `build`, `preview`, `typecheck`, `lint`, `env:init`.
  4. Set `nitro: { preset: 'node-server' }` explicitly. Do not set `ssr` (Nuxt default; the frontend decides, `ui:dev` uses SPA). The file carries the two comment blocks from 3.2.
  5. `.env.example` with `BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL`, `DATA_DIR`, `ALLOWED_ORIGINS` and one explanatory line each; `RATE_LIMIT` (tests only, O5) as a commented-out line. `scripts/init-env.sh` creates a local `.env` from it (random values, no values in the repo).
  6. `shared/api-types.ts` with a header comment (rules from 3.3) and `export {}`.
  7. `app/app.vue` as a placeholder; no further files under `app/`.
  8. Own commit `chore: nuxt scaffold`; report back to the frontend with the commit (milestone reached).
- Check: `pnpm install && pnpm build && node .output/server/index.mjs` starts, `GET /` returns 200; `pnpm typecheck`, `pnpm lint`; test import `#shared/api-types` in `app/` and `server/` (not checked in).
- DoD: build green, `.output/server/index.mjs` starts under Node 24.15+, `nuxi typecheck` without errors with TS 5.9, file list matches section 3.1 (no Tailwind, no shadcn, nothing under `app/` except `app.vue`), A10 met.

### Task 2: Tailwind and shadcn-vue (dropped in 0a, handed over to the frontend)
- Confirmed 2026-11-04: setup of Tailwind, `shadcn-nuxt`/`shadcn-vue`, `components.json`, base components and design tokens is handled by the frontend (`docs/plans/frontend.md`, task 2). 0a delivers nothing for it except the scaffold from task 1. The number stays as a reference.
- Consequence: the frontend does not wait for task 2 but for the milestone at the end of task 1 (`frontend.md` assumption A2 still says "0a task 1 and 2"; to be adjusted there, not in this plan).

### Task 3: Configuration and master key
- Purpose: fail-fast check of all ENV at startup (A5).
- Files: `server/utils/config.ts`, `server/utils/master-key.ts`, `tests/unit/config.test.ts`, `tests/unit/master-key.test.ts`.
- Steps:
  1. `getConfig()` reads `process.env` once and returns a frozen object: `baseUrl: URL`, `betterAuthSecret: string`, `masterKey: Buffer`, `databaseUrl: string | undefined` (empty = undefined), `dataDir: string` (default `./data`), `allowedOrigins: string[]` (comma-separated, default `[baseUrl.origin]`, each entry parsed as an origin), `rateLimitEnabled: boolean` (`RATE_LIMIT=off` → false, otherwise true; O5).
  2. Rules: `BASE_URL` required, `https:` except host `localhost`/`127.0.0.1`/`[::1]`; `BETTER_AUTH_SECRET` required, >= 32 characters; `MASTER_KEY` required, exactly 32 bytes as Base64 or 64 hex characters (format is an assumption, documented in `.env.example`, generate with `openssl rand -base64 32`); `DATABASE_URL` if set must start with `postgres://` or `postgresql://`; `RATE_LIMIT` only `off` or empty.
  3. Collect errors and throw them as one message (`ConfigError`) that names only variable names and rule, never values.
  4. `getMasterKey()` returns the `Buffer` from `getConfig()`. **No** per-user derivation in this file: `deriveUserKey`/`decryptSecret` belong to phase 1 in `server/gateway/crypto/secrets.ts` (review decision).
- Check: `pnpm vitest run tests/unit` with cases: valid, missing, wrong length, `http://` non-localhost, `http://localhost`, empty `DATABASE_URL`, `RATE_LIMIT=off`, error message does not contain the key.
- DoD: unit tests green, message contains no secret value (test searches the test key in the message text).

### Task 4: DB layer (PGlite or Postgres, one client, init promise)
- Purpose: uniform `Db` interface, switching only via `DATABASE_URL` (P0-11); the migration runs exactly once inside `getDb()`, so that no request gets through before it finishes (B1, A8).
- Files: `server/db/index.ts`, `server/db/migrate.ts` (called from `getDb()`, content task 7), `server/db/schema/index.ts`.
- Steps:
  1. Dependencies: `drizzle-orm`, `@electric-sql/pglite`, `pg`, dev: `@types/pg`.
  2. `getDb()`: asynchronous, **a promise created once** (memoized via `globalThis`, protects against a double instance during dev HMR). The promise does in this order: `getConfig()` → create client → `runMigrations(db)` → return `db`. Without `DATABASE_URL`: `PGlite.create(join(dataDir, 'pgdata'))` + `drizzle({ client, schema })` from `drizzle-orm/pglite`. With URL: `new Pool({ connectionString })` + `drizzle(pool, { schema })` from `drizzle-orm/node-postgres`. All callers (auth, routes, later plugins) thus get the `Db` only after the migration; if it fails, the promise stays rejected and every call fails.
  3. Shared type `Db = PgDatabase<any, typeof schema>` (base class of both drivers); all consumers type only against `Db`.
  4. Export `dbBackend: 'pglite' | 'postgres'` and `closeDb()` (PGlite `close()`, pool `end()`; idempotent, resets the promise).
  5. Rules in the file header: no PGlite-specific SQL, no extensions, no long transactions; no `withTx` helper (YAGNI), no `casing` flag (the schema names columns explicitly).
- Check: `select 1` in both backends via script (`pnpm tsx` one-liner or test in task 10); two parallel `getDb()` calls before completion run the migration only once.
- DoD: both paths return `select 1`; the second `getDb()` call returns the same instance; migration once per process.

### Task 5: Better Auth factory, `admin()` plugin and schema generation
- Purpose: define the auth configuration once, generate the Drizzle schema from it (including role/ban) (A6, A9).
- Files: `server/auth/options.ts`, `server/auth/index.ts`, `server/auth/auth.cli.ts`, `scripts/gen-auth-schema.sh`, `server/db/schema/auth.ts` (generated), `server/db/schema/index.ts`.
- Steps:
  1. Dependencies: `better-auth`, `@better-auth/drizzle-adapter`; CLI not global but via `pnpm dlx auth@1.7.17`.
  2. `options.ts` exports `buildAuthOptions(cfg)` without DB: `baseURL`, `secret`, `trustedOrigins: cfg.allowedOrigins`, `emailAndPassword: { enabled: true }` (without `sendResetPassword`, without `requireEmailVerification`; `user.changeEmail` and `user.deleteUser` stay off because there are no mail functions and no self-deletion; option names **unverified**, check against the docs during implementation), `plugins: [admin()]` (delivers `role`, `banned`, `ban_reason`, `ban_expires`), registration lock and first-user admin (task 8, O1), `rateLimit: { enabled: cfg.rateLimitEnabled, … customRules }` for sign-in/sign-up (U5), leave the `advanced.ipAddress.ipAddressHeaders` default. Further plugins (`jwt()`, `mcp()`) are added here by 0b.
  3. `index.ts`: `getAuth()` async and memoized: `await getDb()` (so after the migration) → `betterAuth({ ...buildAuthOptions(cfg), database: drizzleAdapter(db, { provider: 'pg', schema }) })`. Spike (repeat U2 in the Nuxt build): if `provider: 'pg'` does not run with PGlite in the built artifact, abort and report back to the spec; a fallback to the Kysely/pg adapter is not wanted.
  4. `auth.cli.ts` builds the same options (including `admin()`) with fixed dummy values, **valid `baseURL`** (otherwise abort with "Invalid URL", B12) and `{} as never` as DB, relative imports only (U7); the file is never loaded at runtime.
  5. `gen-auth-schema.sh`: `pnpm dlx auth@1.7.17 generate --config server/auth/auth.cli.ts --output server/db/schema/auth.ts --adapter drizzle --dialect postgresql -y`. Result with the header comment "generated, do not edit".
  6. Schema re-export in `schema/index.ts`; own tables (upstreams, tokens, audit, settings) come only in 0b/phase 1, without table prefix.
- Check: run the script twice, `git diff --exit-code server/db/schema/auth.ts` (deterministic). Tables user, session, account, verification present; `user` has `role`, `banned`, `ban_reason`, `ban_expires`.
- DoD: schema committed, script reproducible, `getAuth()` compiles.

### Task 6: drizzle-kit configuration and first migration
- Purpose: versioned migrations (A6).
- Files: `drizzle.config.ts`, `server/db/migrations/0000_*.sql` + `meta/`, `package.json` scripts.
- Steps:
  1. `drizzle.config.ts`: `dialect: 'postgresql'`, `schema: './server/db/schema/index.ts'`, `out: './server/db/migrations'`. No `dbCredentials` needed since only `generate`.
  2. Scripts: `db:schema` (task 5), `db:generate` (`drizzle-kit generate`), `db:check` (`drizzle-kit check`, mandatory in CI because of journal collisions, B23).
  3. Run `pnpm db:generate --name init`, check the SQL (standard Postgres DDL only; already contains the `admin()` columns). This is migration `0000`.
  4. Document the rule: migrations are never edited afterwards; schema change = `db:schema` + `db:generate`; schema changes strictly sequential (0a → 0b → phase 1), no parallel migration branches.
- Check: running `pnpm db:generate` again reports "nothing to migrate"; CI step: `db:schema && db:generate && db:check && git diff --exit-code`.
- DoD: `0000_init.sql` checked in, idle generation without a diff.

### Task 7: Migration at startup, init plugin, health, shutdown (with spike in the build)
- Purpose: startup sequence with fail fast; readiness (A4, A5, A7, A8).
- Files: `server/db/migrate.ts`, `server/plugins/00-init.ts`, `server/routes/healthz.get.ts`, `server/routes/readyz.get.ts`, `nuxt.config.ts` (copy hook).
- **Spike first (in the built Nuxt, not in the dev server), termination criterion: if one of the three results turns out differently, adjust the plan and report back:**
  1. Init promise: start the process and immediately (before the migration ends) fire requests at `/api/auth/get-session`. Expectation: no schema error, answers only after the migration (U4 refuted, review S4).
  2. Migrations folder: is `server/db/migrations` copied via the copy hook to `.output/server/migrations` and found at runtime (R3)?
  3. SIGTERM: does Nitro call the `close` hook so that `closeDb()` closes PGlite (U8)? Otherwise an own `process.on('SIGTERM')` handler.
- Steps:
  1. `runMigrations(db)`: per backend `migrate` from `drizzle-orm/pglite/migrator` or `drizzle-orm/node-postgres/migrator` with `migrationsFolder` from `resolveMigrationsDir()`: ENV-free, default `<cwd>/server/db/migrations` in dev, in the build `.output/server/migrations`. It is called exclusively from the init promise of `getDb()` (task 4), never from the plugin.
  2. Nitro hook `compiled` (or `nitro.hooks`) copies `server/db/migrations` to `.output/server/migrations`; resolve the path at runtime relative to `import.meta.url` of the server bundle (test in the build, not only in dev).
  3. `00-init.ts` only kicks off: `getConfig(); getMasterKey(); getDb().then(() => getAuth()).then(markReady).catch((e) => { console.error(…); process.exit(1) })` (U3). The plugin does **not** wait for it (Nitro does not either); securing the requests lies in `getDb()`/`getAuth()`. Synchronous config errors (A5) also end the process with exit code 1. On the Nitro hook `close` (or SIGTERM handler, U8): `closeDb()`.
  4. `/healthz`: 200 if `select 1` works (via `getDb()`), otherwise 503. `/readyz`: 200 only after `markReady()`, otherwise 503. Responses without details (public). Phase 1 changes these files (supervisor check).
  5. Migrations idempotent: Drizzle does not re-run already applied ones; additionally a test (A4).
- Check: manually `MASTER_KEY=… node .output/server/index.mjs` twice; `curl /readyz`; without `MASTER_KEY` → exit code 1; race test (A8).
- DoD: start, restart, failed start behave as A4/A5/A8; spike results (date, environment) noted in the plan.

### Task 8: Auth route, registration lock, admin and server helpers
- Purpose: Better Auth endpoints under `/api/auth/*`, atomic registration lock, first user = admin, reusable session check for 0b/phase 1 (A9).
- Files: `server/api/auth/[...all].ts`, `server/utils/session.ts`, `server/utils/mutex.ts`, `server/auth/options.ts` (hooks), `server/auth/registration.ts`, `shared/api-types.ts` (contribution, step 6).
- Steps:
  1. Handler: `const auth = await getAuth(); return auth.handler(toWebRequest(event))` (as in the Better Auth Nuxt docs, h3 v1). Requests to `/sign-up/email` run **inside the process-wide mutex** (`withMutex(() => auth.handler(...))`, simple promise-chain mutex in `mutex.ts`; ponytail: single-instance assumption, with multiple instances solve at the DB level). This makes "count, check, create" atomic and secures the lock against the `count(*)` race (B3).
  2. Lock in `options.ts` via `hooks.before` (`createAuthMiddleware`) only for the path `/sign-up/email`. The hook calls `canRegister()` from `server/auth/registration.ts` and on `{ ok: false }` throws an `APIError` (403) "Registrierung geschlossen" with the stable code `REGISTRATION_CLOSED` (field and response shape of Better Auth **unverified**, check in the spike; the code stands as a constant in `shared/api-types.ts` so that the frontend can map the message). 0a implementation of `canRegister()`: count users (`select count(*)` via `getDb()`), if > 0 `{ ok: false, code: 'REGISTRATION_CLOSED' }`. Signature: `canRegister(ctx: { email: string; inviteToken?: string }): Promise<{ ok: true } | { ok: false; code: string }>`; 0a does not evaluate `inviteToken`. Phase 1 replaces only the content (token invitation `/invite/<token>`, 7 days, optionally bound to an email) and decides how the token reaches `ctx`; hook, mutex and path stay. The lock deliberately does not hang off `databaseHooks.user.create.before`, so that `auth.api.createUser` (admin) keeps working (U9, check in the spike).
  3. First user = admin: `databaseHooks.user.create.before` sets `role: 'admin'` if no user exists yet (inside the mutex, U10). All later users arise via the admin API with role `user`.
  4. `requireUser(event)`: `auth.api.getSession({ headers: event.headers })`, otherwise `createError({ statusCode: 401 })`; returns `{ user, session }`. `requireAdmin(event)`: like `requireUser`, additionally `user.role === 'admin'` and `!user.banned`, otherwise 403. Both in `server/utils/session.ts` (one name for all phases, review decision; 0b/phase 1 build `getSessionOrNull` or similar on top only if needed).
  5. Test users: the harness creates further users via the admin API (`POST /api/auth/admin/create-user` with the admin session of the first user, HTTP counterpart of `auth.api.createUser`), helper `createUser()` in `tests/integration/harness.ts`.
  6. Contribution to the contract `shared/api-types.ts` (section 3.3): `Role` (`'admin' | 'user'`), `AuthSessionUser` (`id`, `name`, `email`, `role`, `banned`), `ApiErrorBody` (`statusCode`, `statusMessage`, `data?: { code?: string; field?: string; message?: string }`, the shape is a wish of the frontend, E10, for `/api/auth/*` the shape of Better Auth, check in the spike) and the constant `REGISTRATION_CLOSED`. The response of `get-session` is secured in the test with a `satisfies`-like check (field `role` present).
  7. Session self-management for `/settings` (frontend): the Better Auth core provides `update-user`, `change-password`, `list-sessions`, `revoke-session` (names **unverified**). 0a builds nothing for this, but checks in the smoke test (`auth.test.ts`) per endpoint that it answers for a signed-in session, and reports deviating names or shapes to the frontend. No mail functions (section 2).
- Check: `curl -X POST /api/auth/sign-up/email` (JSON `name,email,password`) → 200 and Set-Cookie, `role=admin`; second public sign-up → 403; 10 parallel first registrations → exactly one user; admin creates user B via `create-user`; `sign-in/email` → 200.
- DoD: auth endpoints run against PGlite and Postgres, `requireUser`/`requireAdmin` checked with a test route (test route only in the test, not in product code).

### Task 9: Auth pages (handed over to the frontend; 0a delivers only the API)
- Confirmed 2026-11-04: `/login`, `/register`, the protected start page, `auth-client.ts` and the page middleware are built by the frontend (`docs/plans/frontend.md`, tasks 5 and 7) against the API from task 8. 0a creates nothing under `app/`; the number stays as a reference. Paths are fixed: `/login` (not `/sign-in`), `/register`; 0b sets `loginPage: "/login"`.
- What 0a assures the frontend (contract, checked in `auth.test.ts`):
  1. `POST /api/auth/sign-up/email` (`name`, `email`, `password`), `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, `GET /api/auth/get-session` with `user.role` and `user.banned`.
  2. Locked registration: status 403 with code `REGISTRATION_CLOSED` (task 8, step 2). Wrong password: 401. Both response shapes are recorded in the test so that the frontend's mock can replicate them.
  3. The frontend may use `createAuthClient` from `better-auth/vue` without `baseURL` (same origin); `ALLOWED_ORIGINS` and `BASE_URL` must match the development origin (`.env` from `pnpm env:init`).
  4. Registration page: the invitation as a token link (`/invite/<token>`) comes only with phase 1; the 0a interface is open for it (O1, `canRegister()`).
- Not a task for 0a, no browser test in the 0a acceptance.

### Task 10: Integration tests against PGlite
- Purpose: A1, A2, A4, A5, A7, A8, A9 automated (see section 6).
- Files: `tests/vitest.config.ts`, `tests/integration/*`, `package.json` (`test`, `test:int`).
- Steps:
  1. `harness.ts`: `startServer(env)` starts `node .output/server/index.mjs` as a child process on a free port, waits for `/readyz`, delivers `stop()` (SIGTERM, waits for exit). `api()` keeps cookies. Helpers `signUpFirstAdmin()` and `createUser()` (task 8). Shared by 0b and phase 1; the frontend uses the harness for its contract and real tests read-only (`frontend.md` task 18), does not change it, and the signatures are therefore to be kept stable.
  2. `global-setup.ts`: `TEST_BACKEND` (default `pglite`): temp `DATA_DIR` via `mkdtemp`; default test values for `BASE_URL=http://localhost:<port>`, secret, `MASTER_KEY` and `RATE_LIMIT=off` (O5, otherwise 429 in the build with `NODE_ENV=production`).
  3. `auth.test.ts`: registration (role `admin`), login, wrong password → 401, second public registration → 403, parallel first registrations → exactly one user (A9), user B via `createUser()`, 20 parallel `get-session` calls without errors (A7). Additionally a small test with `RATE_LIMIT` on (default) that sees 429 on many sign-ins, so that the configuration is not silently ineffective.
  4. `startup-race.test.ts`: start the server, immediately without waiting for `/readyz` parallel requests to a DB route; no schema errors (A8).
  5. `restart.test.ts`: register, stop (SIGTERM), start with the same `DATA_DIR`, login works; table `drizzle.__drizzle_migrations` has unchanged 1 row (A4, via helper `countMigrations()`, for PGlite directly via `@electric-sql/pglite` on a stopped instance).
  6. `startup-checks.test.ts`: without `MASTER_KEY`, with a short secret, with `http://example.com` → exit code ≠ 0, stderr contains variable names, not the value (A5).
- Check: `pnpm build && pnpm test`.
- DoD: all tests green against PGlite, run time < 2 min.

### Task 11: Run against a Postgres container
- Purpose: A3 without code change.
- Files: `compose.test.yaml`, `tests/integration/global-setup.ts`, `package.json` (`test:pg`).
- Steps:
  1. `compose.test.yaml`: service `postgres` (image `postgres:17`, tag choice an assumption), port `54329:5432`, healthcheck `pg_isready`, tmpfs for data.
  2. `global-setup.ts` with `TEST_BACKEND=postgres`: connect with `pg` to the admin DB (`TEST_PG_ADMIN_URL`, default `postgres://postgres:test@localhost:54329/postgres`), per test run `CREATE DATABASE mcpwarden_<rand>` and afterwards `DROP DATABASE … WITH (FORCE)`; sets `DATABASE_URL` for the server.
  3. `restart.test.ts` replaces the file check of the migrations table with an SQL query via `DATABASE_URL`; both variants behind the helper `countMigrations()`.
  4. Script `test:pg`: `docker compose -f compose.test.yaml up -d --wait && TEST_BACKEND=postgres vitest run -c tests/vitest.config.ts; docker compose … down -v`.
- Check: `pnpm test:pg` locally.
- DoD: the same test set is green with `TEST_BACKEND=postgres`; no `if (backend)` in product code (only in the test harness).

### Task 12: CI and developer docs
- Purpose: secure both backends permanently; handover to 0b/phase 1.
- Files: `.github/workflows/ci.yml`, `README.md` (section "Development").
- Steps:
  1. Workflow jobs: `check` (install, typecheck, `db:schema && db:generate && db:check`, `git diff --exit-code`, unit tests, build) and `integration` with matrix `backend: [pglite, postgres]`; for `postgres` as `services: postgres` with healthcheck, `TEST_PG_ADMIN_URL` set. Node version from `.nvmrc`.
  2. Build artifact between jobs via `actions/upload-artifact` or rebuild per matrix job (simpler, default: rebuild).
  3. README section: ENV table (six spec names plus test switch `RATE_LIMIT`), changing the schema (`db:schema`, `db:generate`, only sequentially), tests locally (`pnpm test`, `pnpm test:pg`), note "no automatic deployment", note on single instance (mutex, PGlite), section "Responsibilities" (short version of 3.2: `app/**` belongs to the frontend, `server/**` to the backend, shared files and `shared/api-types.ts` with rules) and `pnpm env:init` before the first `dev`/`ui:dev`. The README section "Frontend" belongs to the frontend.
- Check: green CI run (only after the push, which per project rule happens only after the whole stack is finished; until then locally via the scripts from tasks 10/11).
- DoD: workflow file present and syntactically checked locally; both matrix jobs defined.

## 4a. Spike results and implementation notes (2026-11-04, Node 24.13.0, macOS, Nuxt 4.5.2, Nitro 2.13.6, build `NODE_ENV=production`)

- **Better Auth + PGlite in the built Nuxt (U2/R1): green.** `drizzleAdapter(db, { provider: 'pg' })` with PGlite runs in the artifact; sign-up, sign-in, admin endpoints, 20 parallel `get-session`. The same test set is green against Postgres 17 (container).
- **Init promise (U4/B1): confirmed.** `getDb()` resolves only after the migration; `startup-race.test.ts` (requests immediately after process start to `get-session`, `/healthz`, `/readyz`) sees only 200, no schema error.
- **Migrations folder in the build (R3): green.** The Nitro hook `compiled` (registered via `hooks['nitro:init']` in `nuxt.config.ts`) copies to `.output/server/migrations`; `resolveMigrationsDir()` tries candidates relative to `import.meta.url` and `<cwd>/server/db/migrations` (searching for `meta/_journal.json`).
- **SIGTERM (U8): green, no own signal handler needed.** Nitro (`NITRO_SHUTDOWN_SIGNALS`, default `SIGTERM SIGINT`) calls the `close` hook; `closeDb()` closes PGlite, exit code 0, log `shutdown: db closed` (test `restart.test.ts`).
- **U3:** fail fast runs via an explicit `process.exit(1)` in the plugin (config synchronous, init in the `.catch`); test `startup-checks.test.ts` confirms exit code != 0.
- **U5:** `rateLimit.customRules` with path `/sign-in/email` and `/sign-up/email` works; `ratelimit.test.ts` sees 429 with an active limit (client IP in the test via `x-forwarded-for`).
- **U7:** the CLI loads `auth.cli.ts` with relative imports. Important: `database: {} as never` leads to "Failed to initialize database adapter"; solution: `drizzleAdapter({} as never, { provider: 'pg' })`. The warning "Drizzle schema mismatch / Missing tables" during generation is expected and harmless. Generation is deterministic (identical twice), `db:generate` afterwards "nothing to migrate".
- **U9/U10:** the lock hangs in `hooks.before` on `/sign-up/email`; `auth.api.createUser` (admin) works independently of it. `databaseHooks.user.create.before` may set `role: 'admin'` (`{ data: { ...user, role: 'admin' } }`), the first user is admin. Response shape of the lock: HTTP 403, body `{ "message": "Registrierung geschlossen", "code": "REGISTRATION_CLOSED" }` (`AuthErrorBody`).
- **Further verified Better Auth options:** `emailAndPassword.minPasswordLength: 12` (11 characters: HTTP 400); endpoints `update-user`, `change-password`, `list-sessions`, `revoke-session`, `sign-out`, `admin/create-user`, `admin/list-users`, `admin/ban-user` answer as expected (names confirmed in `auth.test.ts`). Banned user: sign-in returns 403.
- **Not checked:** SIGKILL durability (U6), double start on the same `DATA_DIR`.

Deviations from the plan: (1) `canRegister(ctx, countUsers)` receives the count function as a second argument (hook code stays free of DB imports, `auth.cli.ts` loads without the generated schema). (2) `buildAuthOptions(deps)` takes a narrow `AuthDeps` object instead of `cfg`. (3) `runMigrations(db, backend)` receives the backend as an argument (no import cycle). (4) `h3@1.15.11` is a direct dependency (pnpm strict; for `createError` in `session.ts`). (5) `compose.test.yaml` with `TEST_PG_PORT` (default 54329), `test:pg` uses compose project `mcpw-0a`. (6) Additional tests: `first-admin-race`, `ratelimit`, `session` (requireUser/requireAdmin in-process, without a test route in product code). (7) `tests/vitest.config.ts` has two projects (`unit`, `integration`). (8) `scripts/test-init-env.sh` checks mode 600 of `.env`. (9) Tests under `tests/` are not part of `nuxt typecheck`.

## 5. Definition of Done for phase 0a overall

A1 to A10 met (A10 early, with task 1), `pnpm test` and `pnpm test:pg` green, schema generated (with `admin()`) and migration `0000` checked in, spike results from tasks 5/7 (init promise, migration copy, SIGTERM, `provider: 'pg'` in the build) noted in the plan with date and environment, README section present, open points O1 to O6 confirmed by the user or deliberately postponed.

## 6. Test strategy

- **Principle:** what is tested is the built artifact (`.output/server/index.mjs`) as a child process, not the dev server. This covers migration copy, startup sequence, exit codes, rate-limit behavior (production mode) and a real restart. `@nuxt/test-utils` would be possible with Vitest 5 per the peer information (review S6), but is not used: one harness for all phases (review decision).
- **Levels:** unit (config, master key, fast, no build), integration (HTTP against a running server).
- **Backend choice:** ENV `TEST_BACKEND=pglite|postgres`. Only `global-setup.ts` and the helper `countMigrations()` know the difference; the server only sees whether `DATABASE_URL` is set.
- **Rate limit:** tests set `RATE_LIMIT=off`; a single test runs with an active limit (O5).
- **Second users:** via the admin API (`createUser()`), never via public registration (B3).
- **PGlite local/CI:** temp `DATA_DIR` per test run, no external services. Runs in every job.
- **Postgres local:** `docker compose -f compose.test.yaml up -d --wait`; fresh database per run, cleanup via `DROP DATABASE … WITH (FORCE)`.
- **Postgres CI:** `services: postgres` in the matrix job `postgres`, same test code.
- **Not tested in 0a:** SIGKILL durability of PGlite (U6), double start of two processes on the same `DATA_DIR`, dump/switch PGlite → Postgres (phase 1, O4).

## 7. Risks

| Risk | Effect | Countermeasure |
|---|---|---|
| R1 `drizzleAdapter` with PGlite unexpectedly incompatible in the Nuxt build (spike without Nuxt was green) | Auth runs only on Postgres | Repeat the spike in tasks 5/7 in the build; on failure stop and report back (the spec assumption "Better Auth on PGlite" would be refuted) |
| R2 Two processes on the same PGlite directory (e.g. rolling restart in Coolify) | Data corruption | Document; optionally a PID lock file in `DATA_DIR` (not in 0a), deployment as recreate instead of rolling |
| R3 Migrations folder missing in the build/container | App does not start | Copy hook plus a test against the build (tasks 7, 10) |
| R4 Generated schema drifts from migrations | silent inconsistency | CI diff check with `db:check` (task 12) |
| R5 Node locally 24.13 < 24.15 | Nuxt engine warning/error | `.nvmrc` and `engines`, hint in the README |
| R6 Drizzle 1.0 and 0.45 differ (migration format) | Switching later is not trivial | Pin 0.45.x, 1.0 switch as its own task after release |
| R7 PGlite peculiarities (single connection, no parallel pool) | Deadlock on long transactions | one client, no long transactions, parallel test A7 |
| R8 Open registration before phase 1 | Strangers register | Default: locked after the first user (mutex); do not roll out 0a publicly |
| R9 Wrong client IP for the rate limit behind a reverse proxy | Limit ineffective or too strict | Fix `ipAddressHeaders`/`trustedProxies` in phase 1 with the Docker setup and `TRUST_PROXY` (only headers that the proxy overwrites) |
| R10 Vitest 5 very new | Toolchain friction | Fallback Vitest 4 (Better Auth peer allows `^4`); TypeScript already on 5.9.x |
| R11 Nitro does not await plugins (U4 refuted) | Request before migration | Init promise in `getDb()`, `getAuth()` waits, race test A8; always secure new initializers via `getDb()`, not via plugin order |
| R12 Mutex applies only per process | Two admins with several instances | Single instance is the requirement (PGlite, R2); with multi-instance Postgres operation retrofit the lock via DB (advisory lock) |
| R13 PGlite is not closed on SIGTERM (Nitro does not call `close`) | Data loss/inconsistency on restart, A2 red | Spike U8; fallback own signal handler in the init plugin |
| R14 Hook behavior on `createUser`/role assignment deviates (U9, U10) | Lock blocks the admin API or first user without admin | Spike in task 8, if necessary the lock exclusively in `hooks.before` and the role via `auth.api.setRole` after creation |
| R15 Shared files (`package.json`, `nuxt.config.ts`, lockfile, `eslint.config.mjs`) create merge conflicts between 0a and the frontend | Friction, lost changes | separate blocks and keys (3.2), small commits, the frontend branches off the scaffold commit and rebases regularly; resolve lockfile conflicts by regenerating (`pnpm install`) |
| R16 `ui:dev` starts Nitro and `00-init.ts` ends the process without ENV (A5) | Frontend cannot start in mock mode | `pnpm env:init` (task 1) creates a local `.env`; fail fast stays unchanged (3.1) |
| R17 The frontend nevertheless creates files under `server/` or the backend under `app/` | two sources, style break | Ownership table 3.2, review checks diffs for boundary violations |
| R18 Contract drifts (types without route, route without type) | Mock and real operation deviate | Rules 3.3, `satisfies` per route, contract tests of the frontend |

## 8. Interfaces for phase 0b and phase 1

Stable module names and exports per the reconciliation table in the review (paths see section 3; server imports with `~~/server/...`). `user.id` is `text` everywhere.

| Module | Export | Contract |
|---|---|---|
| `server/utils/config.ts` | `getConfig(): AppConfig` | `{ baseUrl: URL, betterAuthSecret, masterKey: Buffer, databaseUrl?: string, dataDir, allowedOrigins: string[], rateLimitEnabled: boolean }`; throws `ConfigError` with variable names. No `runtimeConfig` (0b E1 is dropped). |
| `server/utils/master-key.ts` | `getMasterKey(): Buffer` | 32 bytes; **no** derivation here. `deriveUserKey(userId)` (HKDF, P0-4) and `decryptSecret` live in phase 1 under `server/gateway/crypto/secrets.ts`; `userId` comes from the auth context, never from the data row. |
| `server/db/index.ts` | `getDb(): Promise<Db>`, `closeDb()`, `type Db`, `dbBackend` | exactly one client per process; the promise resolves **only after the migration**; consumers type only against `Db`, no backend knowledge; no `export db`, no `client.ts`, no `casing` flag, no `withTx`. |
| `server/db/schema/index.ts` | all tables | `auth.ts` generated; own tables (0b/phase 1) as additional files, **without table prefix**, with `user_id` → `user.id` (text). 0b creates the settings table (one table for both phases). |
| `server/db/migrate.ts` | `runMigrations(db)` | idempotent; called only from `getDb()`; migrations continue via `db:generate`, never by hand. Order: 0000 (0a incl. `admin()`), 0001 (0b OAuth), 0002 (0b own), from 0003 phase 1. |
| `server/auth/options.ts` | `buildAuthOptions(cfg)` | 0a: `admin()`, registration lock, first-user admin; 0b adds `jwt()`, `mcp()` (`loginPage: "/login"`, scope `mcp:tools`) and regenerates the schema (`pnpm db:schema && pnpm db:generate`). |
| `server/auth/index.ts` | `getAuth(): Promise<Auth>` | memoized, waits for `getDb()`; 0b uses it for `/.well-known/*` (pass through to `auth.handler` or plugin helpers, B13) and the `/mcp` token check. |
| `server/utils/session.ts` | `requireUser(event)`, `requireAdmin(event)` | `{ user, session }` (with `user.role`, `user.banned`) or 401/403; one name for all phases (instead of `requireUserSession`). |
| `server/utils/mutex.ts` | `withMutex(fn)` | process-wide; used by 0a for sign-up, usable for further one-time decisions. |
| `server/routes/healthz.get.ts`, `readyz.get.ts` | HTTP | `/healthz` (DB reachable), `/readyz` (migration and auth ready); phase 1 changes the files (supervisor check). |
| `server/plugins/00-init.ts` | Start | kicks off `getDb()`/`getAuth()`, fail fast, shutdown; does not wait (Nitro does not either). Phase 1 creates `server/plugins/20-gateway.ts`, which waits for `getDb()`. |
| `app/**` | belongs to the frontend | 0a delivers only `app/app.vue` as a placeholder. `/login` and `/register` are built by the frontend against the 0a API; 0b consent, admin layout and all further Vue files likewise (0b delivers only routes). |
| `shared/api-types.ts` | Contract | 0a: empty skeleton (task 1) plus `Role`, `AuthSessionUser`, `ApiErrorBody`, `REGISTRATION_CLOSED` (task 8); rules in 3.3 for all phases. |
| `server/auth/registration.ts` | `canRegister(ctx)` | 0a: first user only; phase 1: token invitation (`/invite/<token>`, 7 days, optionally email-bound). Hook and mutex stay. |
| `tests/` | Harness | `startServer`, `api()`, `signUpFirstAdmin()`, `createUser()`, `countMigrations()`; variables `TEST_BACKEND`, `TEST_PG_ADMIN_URL`; no second harness (`test/helpers`, `TEST_DATABASE_URL` are dropped). |

ENV names (fixed, from spec P0-10): `BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL` (empty = PGlite in `DATA_DIR/pgdata`), `DATA_DIR`, `ALLOWED_ORIGINS` (comma-separated origins, default = origin of `BASE_URL`). Additionally in 0a the test switch `RATE_LIMIT=off` (confirmed 2026-11-04, O5). `STDIO_MODE` and `TRUST_PROXY` come with phase 1; socket path and web UID are constants in the image. New variables only with a spec change (spec v0.4 adds the list).

Responsibilities that 0a does **not** have: audit (`audit_log`, `audit()`) and logger with redaction are created by phase 1 in milestone 1.1; `AuthContext` for `/mcp` (with field `role`), `ToolSource`, origin check and settings table belong to 0b; user management and `user-lifecycle.ts` to phase 1.

Handover notes:
- All: UI files (`app/**`) are delivered only by the frontend, also consent, token and admin pages; the backend phases deliver routes, tests and types in `shared/api-types.ts` (rules 3.3).
- 0b: the core schema is user/session/account/verification plus `admin()` columns (O3). OAuth tables (incl. `oauth_resource`, `oauth_client_resource`) come as migration 0001; `auth.cli.ts` already has a valid `baseURL` (B12), `mcp()` writes resources into the DB at startup and therefore runs only with `getDb()` from 0a. `ALLOWED_ORIGINS` feeds `trustedOrigins` and the origin check for `/mcp` (P0-1, in 0b). `requireAdmin` and `role`/`banned` exist in 0a. Test user B via `createUser()`.
- Phase 1: replace the sign-up lock (O1) by a token invitation (`/invite/<token>`, 7 days, optionally email-bound) in `canRegister()`, add user list, ban (sessions, OAuth refresh tokens, PATs) and delete (milestone 1.1, `user-lifecycle.ts`); the Dockerfile must ship `.output/server/migrations` and make `DATA_DIR` writable for the non-root user; rate-limit proxy configuration (R9, `TRUST_PROXY`).
- **PGlite → Postgres switch test (O4, B4):** lies in phase 1 (e.g. task 1.4.3). For it 0a delivers: (a) same schema and same migrations on both backends without backend-specific SQL, (b) `DATABASE_URL` as the only switch, (c) `compose.test.yaml`, `TEST_PG_ADMIN_URL` and the harness with backend choice, (d) clean closing of PGlite on SIGTERM so that the dump runs on a consistent file, (e) `drizzle.__drizzle_migrations` stays part of the dump. Phase 1 adds `pgDump` → `psql` → start with the new `DATABASE_URL` → login (incl. admin role) and a CI job.
