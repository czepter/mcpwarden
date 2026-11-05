# Frontend: implementation plan

As of: 2026-11-04 · Basis: `docs/spec.md` v0.4, UI drafts (Claude artifact `EXj4fJ9FsvkUjZ3o5hVEcM`, 16 boards), comparison in `docs/ui-comparison.md` (findings W1 to W20, questions 1 to 8), backend plans `phase-0a.md`, `phase-0b.md`, `phase-1.md`. Phases 2 and 3 have no plan yet; their routes are listed here as proposals.

Language: this document is English; the product UI is German by decision, so UI labels are quoted in German ("Dashboard", "Widerrufen", …).

Labeling: **assumption** = adopted without asking back, justified in the comparison. **unverified** = not confirmed against official sources. **decided 2026-11-04** = confirmed by the user (questions 1 to 8 of the comparison, in each case the recommendation stated there). The backend plans `phase-0a.md`, `phase-0b.md`, `phase-1.md` are to be adjusted to these decisions (Vue pages drop out there, invitation model, routes `/api/dashboard` and `/api/audit` in phase 1); until then this plan applies and names the deviation as an expectation (section 3, risks R2, R16, R17).

Decisions at a glance (numbers = questions in the comparison, section 6):

| # | Decision (decided 2026-11-04) | Effect in this plan |
|---|---|---|
| 1 | The frontend takes over all `app/**` files (pages, layouts, components); the backend phases deliver API, tests and contract contributions | Section 4, A3, tasks 7 to 11 |
| 2 | Invitation as a token link `/invite/<token>`, valid 7 days, optionally bound to an email | Route map, section 9, tasks 7 and 11 |
| 3 | Email change, notification mails and account self-deletion are dropped (removed from plan and draft implementation). As of 2026-11-05: mail sending is optional (spec P1 "Mailer"); only the password reset is built (`/forgot-password`, `/reset-password`, link on `/login` only with `mail: true`), everything else stays dropped | Task 8, section 9 |
| 4 | Dashboard (clients, attention) and audit reading already run after phase 1 (routes `/api/dashboard` without KPIs, `/api/audit`) | Route map, section 15, task 13 |
| 5 | Consent with two switches (`mcp:tools` always, `mcpwarden:admin` deselectable); the admin scope switch stays hidden until phase 2 | Task 7, section 11 |
| 6 | Audit: users see their own entries, admins additionally instance events | Section 11, task 13 |
| 7 | Tags and device names dropped; "Alle testen" later with confirmation and rate hint; availability and heatmap only with `health-history` from phase 2 | Tasks 10, 14, 16 |
| 8 | Dark mode after phase 2; the choice "System" stays hidden until then | Section 2, A8, task 8 |

## 1. Goal and acceptance criteria

Goal: build the web UI of mcpwarden (Nuxt 4, shadcn-vue, Better Auth) so that a single agent can implement it **without changes to `server/`**, runs against a mock before the backend phases, and is switched to real routes phase by phase.

Acceptance (each item checkable):

- [ ] F1 All 16 draft boards are implemented as pages or states (route map, section 5), including the empty, loading and error states added in the comparison.
- [ ] F2 `pnpm ui:dev` starts the complete UI with mock data without a running backend (section 13); `pnpm dev` runs against the real routes. Per mock domain the switch is one line of configuration.
- [ ] F3 The contract `shared/api-types.ts` covers every route used in the frontend; mock responses and (once available) real responses pass the same contract test.
- [ ] F4 Secrets (upstream tokens, PATs, invitation links, env values) appear nowhere after saving: not in the DOM, not in network responses, not in browser storage (canary test, section 10).
- [ ] F5 Role-dependent visibility (admin / user) works in navigation and page protection; every action stays additionally checked server-side (section 11).
- [ ] F6 Every page passes axe-core without violations of the levels "serious" and "critical"; keyboard operation and focus handling are checked per page (section 12).
- [ ] F7 Status is never conveyed by color alone (dot and text), target sizes for controls at least 44 px as in the draft.
- [ ] F8 Sidebar collapsible and expandable (248 px / 64 px), state persists after reload; usable below 700 px.
- [ ] F9 After 0a, login, registration and session run against real data; after 0b consent, tokens, clients, admin clients (DCR); after phase 1 upstreams, tool filter, admin users/invitations/instance, accepting an invitation (`/invite/<token>`), dashboard (clients, attention), audit reading, stdio hints (section 15).
- [ ] F12 Dropped elements are built or reachable nowhere: tags, device names, email change, notification mails, account self-deletion, "Alle testen" (until later), color scheme choice "System"/"Dunkel" (until after phase 2). Test: E2E searches for these texts and routes and finds none.
- [ ] F13 Login, registration and accepting an invitation are frontend pages (`/login`, `/register`, `/invite/<token>`); the backend phases deliver only API and tests. Invitation: token valid 7 days, optionally bound to an email, invalid or expired tokens show a comprehensible error page.
- [ ] F14 Consent shows two switches: `mcp:tools` (always on, not deselectable) and `mcpwarden:admin` (deselectable, visible from phase 2); the result of the selection goes to the server, which grants only the chosen scopes.
- [ ] F10 Time and number formats German (`Intl`, browser time zone), relative times ("vor 8 s") update themselves.
- [ ] F11 No `any` at the API boundary; `nuxi typecheck` and ESLint green; `pnpm ui:test` green.

Not a goal of this plan: backend routes, database, MCP endpoint, supervisor, email sending (dropped, decision 3), dark mode values (come after phase 2, decision 8).

## 2. Checked versions and assumptions

Checked on 2026-11-04. "npm" = `npm view <package> version`. "Docs" = official documentation fetched (shadcn-vue.com, nuxt.com, mswjs.io). The stack model is shadcn-vue, **not** Nuxt UI (`@nuxt/ui` is not used).

| Package | Version | Source | Usage / remark |
|---|---|---|---|
| `nuxt` | 4.6.4 | npm, plan 0a | Default directory `app/` confirmed by the docs; `ssr`, `routeRules`, `runtimeConfig.public` exist (docs) |
| `shadcn-vue` (CLI) / `shadcn-nuxt` | 2.9.0 / 2.9.0 | npm | Installation per docs: `tailwindcss`, `@tailwindcss/vite`, module `shadcn-nuxt` with `shadcn: { prefix: '', componentDir: '@/components/ui' }`, `pnpm dlx shadcn-vue@latest init`, `add <name>` |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.4 | npm, plan 0a | CSS `@import "tailwindcss";`, Vite plugin in `nuxt.config.ts` (docs) |
| `reka-ui` | 2.11.0 | npm | comes via shadcn-vue; version not separately checked against the docs (unverified) |
| `@vueuse/core` | 15.0.0 | npm | Docs require it for the optional plugin `ssr-width`; in the plan additionally for `useIntervalFn`, `useDocumentVisibility`, `useClipboard` (API from memory, **unverified**) |
| `vee-validate`, `@vee-validate/zod` | 4.15.1 / 4.15.1 | npm; docs (form page) | Docs show `toTypedSchema(z.object(...))` and `useForm({ validationSchema })`. The form component is "no longer in active development", `Field` is recommended (docs). Plan: **`Field` family + vee-validate** |
| `zod` | 4.6.7 | npm | Plan 1 pins `zod@^4.2`. Compatibility of `@vee-validate/zod` 4.15.1 with zod 4 is **unverified** (spike in task 2); the Field docs name "Standard Schema" error lists as an alternative way |
| `vue-sonner` | 2.0.9 | npm; docs | `shadcn-vue add sonner`; `<Toaster />` in the root layout, `toast()` from `vue-sonner`, stylesheet `vue-sonner/style.css` (docs) |
| `@unovis/vue` | 1.7.1 | npm; docs | `shadcn-vue add chart` builds on Unovis; components `ChartContainer`, `ChartTooltip(Content)`, `ChartCrosshair`, `ChartLegendContent`; colors via `chartConfig` and `--chart-n` (docs). `accessibilityLayer` does not appear in the docs |
| `@tanstack/vue-table` | 9.3.1 | npm; docs (data table: v9) | **not used**: lists are small (≤ 50 upstreams), a simple `Table` suffices |
| `@nuxtjs/color-mode` | 4.1.0 | npm; docs | `colorMode: { classSuffix: '' }`, `useColorMode()`; initially only light fixed, the choice "System" is hidden; choice System/Hell/Dunkel only after phase 2 (decided 2026-11-04) |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | 5.3.0 / 5.3.0 | npm | Fonts local instead of Google Fonts (comparison item 43); import paths **unverified** |
| `lucide-vue-next` 1.0.0 / `@lucide/vue` 1.68.0 | npm | both exist; which package `shadcn-vue init` 2.9.0 enters is **unverified** (`iconLibrary` in `components.json` decides) |
| `msw` | 3.0.3 | npm; docs (migration 2 → 3, quickstart) | Node ≥ 22; `http` and `HttpResponse` from `msw/http`; `setupWorker` from `msw/browser`; `setupServer` from `msw/node`; `onUnhandledFrame` instead of `onUnhandledRequest`; optional Vite plugin `msw/vite` delivers the worker (migration docs). Browser setup in Nuxt **unverified** (spike task 4) |
| `vitest` / `@vue/test-utils` | 5.1.0 / 2.5.1 | npm, plan 0a | Component and contract tests |
| `playwright` / `@axe-core/playwright` | 1.64.1 / 4.14.0 | npm | E2E and accessibility against the mock mode |

Assumptions:

- A1 **Implementation by an agent** on branch `feat/frontend` (kebab-case per project rule), push only after the complete stack, nothing committed in this assignment. Implementation with Sonnet 5.5 or Haiku, review with Opus.
- A2 **Starting point (milestone "scaffold ready"):** the frontend begins only when the scaffold of phase 0a stands. `phase-0a.md` does not explicitly name a milestone "scaffold ready" (state of the check: only tasks 1 to 12); **fixed in `phase-0a.md` (section 3.1, acceptance A10):** the milestone "scaffold ready" is the end of 0a task 1 with the commit `chore: nuxt scaffold` (Nuxt scaffold, `package.json`, `nuxt.config.ts`, lockfile, ESLint, empty `shared/api-types.ts`, placeholder `app/app.vue`; without Tailwind and shadcn). Tailwind, shadcn-vue and the base components are created by the frontend itself (task 1). Until then the frontend does **not** work on `package.json` and `nuxt.config.ts` and does not create a second scaffold; only preparatory work without these files is allowed (contract `shared/api-types.ts`, draft of the mock handlers and seed under `mocks/`, label table, texts). As soon as the milestone stands, task 1 adds the own keys in these files.
- A3 **Vue pages belong to the frontend** (decided 2026-11-04, question 1). The frontend takes over all `app/**` files (pages, layouts, components). The pages named by 0a task 9, 0b tasks 3 to 5 and phase 1 tasks 1.1.8 to 1.1.10, 1.3.5 are built here; the backend phases deliver API, tests and contract contributions (`shared/api-types.ts`). This also applies to login, registration and accepting an invitation, which the backend phases no longer build (task 7). The backend plans are to be shortened accordingly (expectation, risk R2).
- A4 **Language:** UI German, API values English (enums such as `auth_expired`), display via the label table `app/lib/labels.ts`.
- A5 **Data fetching in the signed-in area only on the client** (`useAsyncData(..., { server: false })`). Reason: same behavior with mock (SPA) and real (SSR shell), no cookie forwarding in SSR. `/login`, `/register`, `/consent` may use SSR.
- A6 **Polling instead of push**: auto-refresh 15 s / 30 s / 1 min / off; pauses when the tab is hidden.
- A7 **Scope names, status names, limits** as recommended in section 4 of the comparison (W1, W2, W4, W6).
- A8 **Dark mode after phase 2** (decided 2026-11-04, question 8): until then only light, the choice "System" and "Dunkel" is hidden; the tokens are named so that `.dark` later only adds values.
- A10 **Dropped** (decided 2026-11-04, questions 3 and 7): tags, device names, email change, notification mails, account self-deletion. "Alle testen" only later (task 16). Availability and heatmap only with `health-history` from phase 2.
- A9 **One tenant per browser session**: no user switch without signing out; stores are cleared on sign-out.

## 3. Expectations of the backend phases

The frontend presupposes what the plans promise and names additions as a wish to the backend agents (no intervention in `server/`). Check each row as soon as the phase is done.

| # | Expectation | Phase | Plan promises it |
|---|---|---|---|
| E1 | Better Auth endpoints under `/api/auth/*` (sign-up, sign-in, sign-out, `get-session`), user contains `role` and `banned`; error 403 "registration closed" | 0a | yes |
| E2 | Session functions `update-user`, `change-password`, `list-sessions`, `revoke-session` (Better Auth core, names **unverified**) | 0a | no |
| E3 | Minimum password length 12 server-side (W12) | 0a | no |
| E4 | `/api/oauth/consent-info` returns client, redirect URIs, `allowlisted`, `registeredAt`, `viaDcr`, scopes with title, `resource`, `loopback`; the consent accepts a subset of the scopes (`mcp:tools` always included, `mcpwarden:admin` deselectable, decision 5); whether the Better Auth consent supports the subset is **unverified** | 0b (subset from phase 2) | partly |
| E5 | `/api/me/pats`, `/api/me/connections`, `/api/admin/oauth/*` as in 0b tasks 3 and 5; PAT display prefix `mcpw_pat_` + 4 characters (W13) | 0b | yes (prefix: wish) |
| E6 | `/api/upstreams*` as in 1.1.7/1.1.8/1.2.2 (CRUD, secret, test, tools, tool switch); responses without secret, with `hasSecret` | 1 | yes |
| E7 | List fields `toolsEnabled`, `toolsTotal`, `statusReason`, `nextRetryAt`, `setup` (W1); later `p95Ms`, `recent` | 1 / 2 | no (wish) |
| E8 | `GET /api/me/capabilities` with stdio permission and reason (1.3.5) and limits | 1 | partly |
| E9 | Admin routes `users`, `invites`, `settings` as in 1.1.9, 1.1.10, 1.3.5; user list with `lastActivityAt`, `stdioAllowed`, `limits` | 1 | partly |
| E10 | Uniform error shape `{ statusCode, statusMessage, data:{ code, field?, message } }` (h3 `createError`) | all | no (wish) |
| E11 | `GET /api/audit` (reading; users own entries, admin additionally instance events, decision 6) and `GET /api/dashboard` (clients, attention, without KPIs) already in phase 1 (decided 2026-11-04, decision 4) | 1 | no (plan 1 to be adjusted) |
| E13 | Invitation as a token link: `POST/GET/DELETE /api/admin/invites` (token only in the link on creation, 7 days, optional email binding), `GET /api/invites/:token` (public: valid, bound email, expiry), registration with token via sign-up (decision 2) | 1 | no (plan 1 has an email allowlist, to be adjusted) |
| E14 | Backend phases no longer build `app/**` files, not even login and registration (decision 1) | 0a to 1 | no (plans to be shortened) |
| E12 | Statistics, history, link, approval routes from comparison section 5 | 2 | no plan |

As soon as `shared/api-types.ts` stands (task 3), the backend agents check their responses with `satisfies` against these types. Changes to the contract go through small, agreed commits (section 4).

## 4. Ownership, directory structure and contract at the boundary

**The frontend owns:** `app/**` (all pages, layouts and components, including login, registration, invitation; decided 2026-11-04), `mocks/**`, `shared/api-types.ts` (first version, afterwards shared), `public/mockServiceWorker.js` (generated), `tests/ui/**`, `components.json`, `.github/workflows/ui.yml`. **Shared (touch only own keys):** `package.json` (own dependencies, scripts with prefix `ui:`), `nuxt.config.ts` (only `ssr`, `modules` entries `shadcn-nuxt` and `@nuxtjs/color-mode`, `css`, `vite.plugins`, `shadcn`, `colorMode`, `app.head`). **Off limits for the frontend:** `server/**`, `supervisor/**`, `tests/integration/**`, `tests/unit/**`, `tests/helpers/**`, `drizzle.config.ts`, `compose*.yaml`, `Dockerfile`, `.github/workflows/ci.yml`, migrations.

```
mcpwarden/
├── app/
│   ├── app.vue                         # <NuxtLayout><NuxtPage/></NuxtLayout>, <Toaster/>
│   ├── error.vue
│   ├── assets/css/tailwind.css         # tokens (section 7), @font-face via @fontsource
│   ├── layouts/{default,auth}.vue
│   ├── middleware/{auth.global,admin}.ts
│   ├── plugins/{ssr-width,msw.client}.ts
│   ├── pages/
│   │   ├── index.vue                   # dashboard
│   │   ├── login.vue · register.vue · consent.vue
│   │   ├── invite/[token].vue          # accept invitation (decided 2026-11-04)
│   │   ├── link/[token].vue · link/done.vue          # phase 2
│   │   ├── upstreams/index.vue · new.vue
│   │   ├── upstreams/[id]/index.vue · edit.vue · approve.vue
│   │   ├── stats.vue · audit.vue
│   │   ├── settings/index.vue · tokens.vue · connections.vue
│   │   └── admin/index.vue (redirect) · users.vue · oauth.vue · settings.vue
│   ├── components/
│   │   ├── ui/…                        # shadcn-vue (CLI-generated, only adjust variants)
│   │   ├── shell/{AppSidebar,PageHeader,AdminTabs,MockBanner}.vue
│   │   ├── common/{StatusBadge,StatusDot,KpiCard,EmptyState,ErrorState,LoadingRows,ConfirmDialog,CopyButton,OneTimeSecret,SecretField,TimeWindow,AutoRefresh,RelativeTime,SparkBars,Heatmap,DataSection}.vue
│   │   ├── upstreams/{UpstreamForm,HttpFields,StdioFields,RestFields,SlugField,ToolTable,TestResult,ErrorBreakdown,SetupHint}.vue
│   │   ├── access/{ScopeList,ClientWarning,RedirectDisplay,PatTable,ConnectionTable}.vue
│   │   ├── admin/{UserTable,InviteDialog,LimitsDialog,AllowlistTable,AllowlistDialog,ClientRegistrations,SsrfList}.vue
│   │   └── stats/{LatencyChart,CallsChart,OutcomeBars,PercentileTable}.vue
│   ├── composables/{useApi,useSessionUser,usePolling,useAttentionCount,useSidebarState,useFormatters}.ts
│   ├── api/{http,auth,upstreams,me,oauth-admin,admin,stats,audit,links,dashboard}.ts      # typed client
│   └── lib/{auth-client,utils,labels,nav,zod-schemas}.ts
├── shared/api-types.ts                 # contract (types and constants only, no Vue, no Nitro)
├── mocks/
│   ├── handlers/{auth,oauth,me,admin-oauth,upstreams,admin,stats,audit,links,dashboard}.ts
│   ├── state.ts · seed.ts · scenarios.ts · browser.ts · node.ts · index.ts
├── (.mocks-public/mockServiceWorker.js)  # generated (msw init), gitignored, only for mock builds via nitro.publicAssets
└── tests/ui/{vitest.config.ts,unit,component,contract,e2e}/
```

**Contract at the boundary:** `shared/api-types.ts`, imported as `#shared/api-types` (alias per Nuxt docs; the file lies directly under `shared/`, so it is **not** imported automatically, only explicitly). Content: per route a `Request` and `Response` type, enums (`UpstreamHealth`, `UpstreamSetup`, `CallOutcome`, `Role`, `DcrMode`, `ToolMode`, `AuthType`, `UpstreamType`), `ApiErrorBody`, path constants. Rules:

1. Only types and constants; no runtime logic, no import of Vue or Nitro (Nuxt docs: shared code may import neither).
2. Timestamps as ISO-8601 strings, numbers in milliseconds with suffix `Ms`, percent as a ratio 0 to 1.
3. Secrets never appear in response types, only `hasSecret: boolean` and input types (`SecretInput`).
4. Adding a field is backward compatible; renaming or removing requires agreement with the backend agent and changes mock, contract test and client in the same commit.
5. The first version stems from comparison section 5; the backend agents add, in the same commit as the route, whatever they build differently.

## 5. Route map

Layout: `default` = sidebar + content, `auth` = centered card without navigation. "Mock" names the mock domain (section 13). "Real from" names the phase from which the page runs against real data.

| Page | Path | File | Layout | Role | Required API | Mock | Real from |
|---|---|---|---|---|---|---|---|
| Dashboard | `/` | `pages/index.vue` | default | user | `GET /api/dashboard` (without KPIs), `GET /api/upstreams` (badge) | dashboard | 1 (clients, attention; decided 2026-11-04) / 2 (KPIs, chart) |
| Sign in | `/login` | `pages/login.vue` | auth | public | `POST /api/auth/sign-in/email`; continuation of the OAuth query | auth | 0a (page: frontend) |
| Register | `/register` | `pages/register.vue` | auth | public | `POST /api/auth/sign-up/email` | auth | 0a (page: frontend) |
| Accept invitation | `/invite/[token]` | `pages/invite/[token].vue` | auth | public | `GET /api/invites/:token`, sign-up with token | admin | 1 (token link, 7 days, optionally bound to an email; decided 2026-11-04) |
| Consent | `/consent` | `pages/consent.vue` | auth | signed in | `GET /api/oauth/consent-info`, `authClient.oauth2.consent` (two scope switches, admin switch from phase 2) | oauth | 0b |
| Auth link | `/link/[token]` | `pages/link/[token].vue` | auth | signed in (owner) | `GET/POST /api/links/:token…` | links | 2 |
| Auth link end | `/link/done` | `pages/link/done.vue` | auth | signed in | query `status` | links | 2 |
| Upstreams | `/upstreams` | `pages/upstreams/index.vue` | default | user | `GET /api/upstreams`, `POST /api/upstreams/:id/test` | upstreams | 1 |
| Create upstream | `/upstreams/new` | `pages/upstreams/new.vue` | default | user | `POST /api/upstreams`, `GET /api/me/capabilities`, `PUT …/secret` | upstreams | 1 |
| Upstream detail | `/upstreams/[id]` | `pages/upstreams/[id]/index.vue` | default | user | `GET /api/upstreams/:id`, `…/tools`, `PUT …/tools/:name`, `…/test`, `PATCH`, `DELETE`, from 2 `…/stats`, `…/health-history` | upstreams, stats | 1 (overview, tools, auth) / 2 (curves) |
| Edit upstream | `/upstreams/[id]/edit` | `pages/upstreams/[id]/edit.vue` | default | user | `GET`, `PATCH`, `PUT …/secret` | upstreams | 1 |
| stdio approval | `/upstreams/[id]/approve` | `pages/upstreams/[id]/approve.vue` | default | user (stdio allowed) | `GET /api/upstreams/:id`, `POST …/approve`, `DELETE` | upstreams | 2 |
| Statistics | `/stats` | `pages/stats.vue` | default | user (admin: instance part) | `GET /api/stats/*`, `GET /api/admin/stats` | stats | 2 |
| Audit | `/audit` | `pages/audit.vue` | default | user (own) / admin (own + instance events) | `GET /api/audit` | audit | 1 (E11, decided 2026-11-04) |
| Settings | `/settings` | `pages/settings/index.vue` | default | user | `/api/auth/update-user` (name only), `change-password`, `list-sessions`, `revoke-session`; without email change, notifications, account self-deletion | auth | 0a (names unverified) |
| Tokens | `/settings/tokens` | `pages/settings/tokens.vue` | default | user | `GET/POST /api/me/pats`, `DELETE /api/me/pats/:id` | me | 0b |
| Clients | `/settings/connections` | `pages/settings/connections.vue` | default | user | `GET /api/me/connections`, `DELETE …/:clientId`, from 3 `GET/PUT /api/me/preferences` | me | 0b / 3 |
| Admin: users | `/admin/users` | `pages/admin/users.vue` | default | admin | `GET /api/admin/users`, `ban`, `unban`, `DELETE`, `PUT …/limits`, `GET/POST/DELETE /api/admin/invites` | admin | 1 |
| Admin: clients (DCR) | `/admin/oauth` | `pages/admin/oauth.vue` | default | admin | `GET/PUT /api/admin/oauth/policy`, `allowlist`, `clients` | admin-oauth | 0b |
| Admin: instance | `/admin/settings` | `pages/admin/settings.vue` | default | admin | `GET/PUT /api/admin/settings` | admin | 1 |
| Error | `error.vue` | `app/error.vue` | default | all | – | – | 0a |

Dropped (no route, no element): email change, notifications, delete account, tags filter, device names, "Alle testen" (until later). The cards "Verfügbar x %" and heatmap in the detail appear only if `health-history` (phase 2) is delivered.

Labels of the navigation follow the draft (Dashboard, Upstreams, Statistik, Clients, Tokens, Audit, Admin, Einstellungen); the paths follow the backend plans (W16, W17). `/admin` redirects to `/admin/users`. The tabs of `Detail` (Übersicht, Tools, Auth, Aufrufe) are tabs within one page with `?tab=`; the tab "Aufrufe" stays hidden until the call log (phase 3).

Middleware: `auth.global.ts` (taken from 0a and extended) allows without a session only `/login`, `/register`, `/invite/*`; otherwise `navigateTo('/login?redirect=<path>')`, whereby a signed OAuth query appended by the plugin stays unchanged (0b R14). `admin.ts` checks `role === 'admin'`, otherwise redirect to `/` with a hint. A banned user (`banned`) or a 401 response leads to `/login`.

## 6. Layout and navigation

The drafts `Dashboard` (expanded) and `DashboardCollapsed` (collapsed) are the same page with state `collapsed`.

- **Building blocks:** shadcn-vue `Sidebar` (`SidebarProvider`, `Sidebar` with `collapsible="icon"`, `SidebarHeader`, `SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuBadge`, `SidebarFooter`, `SidebarRail`, `SidebarTrigger`, `useSidebar`). Docs confirm `defaultOpen`, `open`, `collapsible` (`icon`, `offcanvas`), `variant`, `useSidebar()` with `state`, `open`, `setOpen`, `isMobile`, `openMobile`, `toggleSidebar`, keyboard shortcut Ctrl/Cmd+B. **Not documented (unverified):** cookie or `localStorage` persistence with a fixed name, the variable `--sidebar-width-icon`, the behavior on mobile devices (presumably a sheet). Countermeasure: persistence ourselves via `useSidebarState` (cookie `sidebar_collapsed`, so that the first render is right), check widths via `style` on the `SidebarProvider`.
- **Dimensions:** expanded 248 px, collapsed 64 px (draft). The shadcn default is 16 rem and 3 rem; so set `--sidebar-width: 248px` and `--sidebar-width-icon: 64px` and check in the browser.
- **Structure (from `lib/nav.ts`, one source):**

| Group | Entry | Path | Icon path in the draft | Visible for | Badge |
|---|---|---|---|---|---|
| Betrieb | Dashboard | `/` | house | all | – |
| Betrieb | Upstreams | `/upstreams` | four tiles | all | Number of upstreams with `degraded`, `open`, `auth_expired` (assumption, comparison item 9) |
| Betrieb | Statistik | `/stats` | curve | all | – |
| Zugang | Clients | `/settings/connections` | monitor | all | – |
| Zugang | Tokens | `/settings/tokens` | key | all | – |
| System | Audit | `/audit` | document | all | – |
| System | Admin | `/admin/users` | shield | admin only | – |
| bottom | Einstellungen | `/settings` | slider | all | – |

- **Collapsed:** icons only (20 px), group headings become a 1 px line, badges become an 8 px dot at the top right, every element keeps `aria-label` and `title` (tooltip via `Tooltip`). Focus and keyboard work identically.
- **Content header:** `PageHeader` with breadcrumbs "Home › Page" (`Breadcrumb`), `h1` 20 px, optional description (13 px) and actions on the right (time window, auto-refresh, primary action). One `h1` per page.
- **Foot of the sidebar:** user block (initials in a 32 px circle, name, email with ellipsis) and button "Einklappen"; no sign-out link in the draft, hence a menu on the user block (`DropdownMenu`: Einstellungen, Abmelden) as an addition.
- **Mobile (< 700 px):** the draft turns the sidebar into a horizontal, scrollable bar. Plan: shadcn sidebar in off-canvas mode (`Sheet`) with `SidebarTrigger` in the header. This deviates from the draft and is easier to operate; acceptance by visual check at 375 px (follow up the decision in the review if the horizontal bar is wanted).
- **Content:** `main` with padding 16/24/32 px, spacing between cards 16 px, tables in `overflow-x-auto` with a minimum width (draft: 720 to 1040 px).
- **Further elements:** skip link "Zum Inhalt", `MockBanner` (mock mode only, with role switch), `Toaster` at the bottom right.
- **Admin tabs:** `AdminTabs` (Nutzer, Clients (DCR), Instanz) as sub-navigation with `aria-current="page"`, not as `role="tab"` (comparison section 12).

## 7. Design tokens and typography

Source: style information in the `.dc.html` files (inline styles). The draft uses the Tailwind zinc hex values; Tailwind v4 delivers the palettes in `oklch`, the deviation is minimal, **the hex values of the draft are authoritative** (set colors as hex in `tailwind.css`, do not take them from the palette). The names follow the shadcn variables (docs: `--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--input`, `--ring`, `--destructive`, `--radius`, `--sidebar-*`, `--chart-n`, in `:root` and `.dark`).

**Colors (light):**

| Token | Value | Usage in the draft |
|---|---|---|
| `--background` | `#f4f4f5` | Page background |
| `--card` | `#ffffff` | Cards, tables, sidebar, input fields |
| `--foreground` | `#18181b` | Text, `h1` |
| `--secondary-foreground` | `#3f3f46` | Cell text, inactive navigation |
| `--muted-foreground` | `#52525b` | Breadcrumbs, help texts, table head, group heading |
| `--border` | `#e4e4e7` | Card border, dividers, input border |
| `--input-strong` | `#a1a1aa` | Border of the secret field in the focus context (`AuthLink`), border of the selected permission |
| `--muted` | `#f4f4f5` | Row dividers, progress bar background, table footer, search field in the detail |
| `--table-head` | `#fafafa` | Table head, active permission box |
| `--primary` (accent) | `#3730a3` | Primary button, active navigation item, links, selection border, key figure chart; selectable `#0f766e`, `#18181b`, `#b91c1c` (property `accent`) |
| `--primary-foreground` | `#ffffff` | Text on accent |
| `--primary-tint` | `#eef2ff` | selected tile, selected entry in the upstream list (derive for other accents via `color-mix`, **unverified**) |
| `--destructive` | `#991b1b` | Text "Widerrufen", "Sperren" warnings |
| `--destructive-soft` | `#b91c1c` | Delete button, error dot of the status card |
| `--destructive-border` | `#fecaca` | Border of the danger buttons and cards |
| `--nav-badge` | `#991b1b` | Counter in the navigation (text `#ffffff`) |

**Status colors (always dot or chip plus text):**

| State | Chip background | Chip text | Dot/bar | Place in the draft |
|---|---|---|---|---|
| healthy | `#dcfce7` | `#166534` | `#15803d` (card), `#16a34a` (bar) | Main, Detail |
| degraded | `#fef3c7` | `#92400e` | `#b45309`, bar `#d97706`, heatmap `#f59e0b` | Main, Detail |
| open | `#fee2e2` | `#991b1b` | `#b91c1c`, bar `#dc2626`, heatmap `#991b1b` | Main, Detail |
| auth_expired | `#dbeafe` | `#1e40af` | `#1d4ed8` | Main |
| disabled | `#f4f4f5` | `#3f3f46` | `#71717a`, bar "no data" `#e4e4e7` | Main |
| Online (client) | – | `#166534` | same color | Dashboard, Clients |
| Inaktiv (client) | – | `#3f3f46` | same color | Dashboard |

**Notice boxes:** warning background `#fef3c7`, text `#78350f`, border `#fcd34d` (consent, StdioFreigabe, detail). Success background `#dcfce7`, text `#14532d`, border `#86efac` (token banner, invitation, test result). "No data" in the heatmap: hatching `repeating-linear-gradient(45deg, #f4f4f5, #f4f4f5 3px, #d4d4d8 3px, #d4d4d8 4px)`. Chart lines in `Detail`: p50 `#1d4ed8` solid, p95 `#b45309` dashed `6 3`, p99 `#3f3f46` dotted `2 3` (distinction not by color alone).

**Typography:** families Inter (400, 500, 600, 700) and JetBrains Mono (400, 500), local via `@fontsource-variable/*` (import paths **unverified**), fallback `system-ui` and `ui-monospace, monospace`. Base font 14 px, line height 1.4 (card and form pages 1.45).

| Role | Size / weight | Addition |
|---|---|---|
| `h1` page | 20 px / 600 | letter spacing -0.01em |
| `h1` auth card | 18 px / 600 | |
| `h2` section (admin, settings) | 16 px / 600 | |
| `h2`/`h3` card | 15 px / 600 | |
| Detail title | 18 px / 600 | |
| Body text, table cell | 14 px / 400 | |
| Label, breadcrumb addition, help text | 12 to 13 px | `--muted-foreground` |
| Table head | 12 px / 500 | `--muted-foreground` |
| Key figure | 24 px / 700 (dashboard, upstreams), 22 px (detail, statistics) | `font-variant-numeric: tabular-nums` |
| Navigation | 14 px / 500; brand 15 px / 700 | |
| Group heading | 11 px / 600, uppercase, 0.04em | |
| Chip / badge | 12 px / 500 (counter 11 px / 600) | |
| Code, URLs, commands, tool names | JetBrains Mono 12 to 13 px | `overflow-wrap: anywhere` |

**Shape and dimensions:**

| Property | Value |
|---|---|
| Radius of controls (button, input, box) | 6 px |
| Radius of cards, tile statistics | 10 px |
| Radius logo, auth logo | 8 px; chips 999 px; small tags 4 px; bars 2 to 3 px |
| Height of buttons, inputs, navigation entries | 44 px (tabs 40 px in the switcher, navigation min. 44 px) |
| Card padding | 14 to 20 px; table rows 8 px vertical, 20 px horizontal; grid gap tables 12 px |
| Auth/consent card | max. 480 px, padding 28 px, shadow `0 1px 2px rgba(0,0,0,0.05)`; form card 600 px |
| Settings content | max. 720 px |
| Sidebar | 248 / 64 px, padding 12/8 px, entry height 44 px, icon 20 px |

shadcn-vue docs: `--radius` default 0.625 rem (10 px), derived 0.6× (6 px), 0.8× (8 px), 1× (10 px). Thus `rounded-sm` yields the 6 px of the controls and `rounded-lg` the 10 px of the cards; button and input from the CLI use a different step by default and are set to `rounded-sm` and height 44 px in task 2 (derivation factors from the docs, check the result in the build).

**Numbers and time:** decimal comma, thousands separator as a narrow non-breaking space as in the draft ("1 840", "9 874"); helper function `formatNumber` instead of `toLocaleString`, because `de-DE` yields a dot. Units with a space ("212 ms", "60 s", "98,7 %"). Relative time via `Intl.RelativeTimeFormat('de')` ("vor 8 s"), absolute dates `TT.MM.JJJJ`, "heute HH:MM" in the audit.

**Microcopy and terms (glossary, `lib/labels.ts`):** status as comparison W1 (proposal: "In Ordnung", "Eingeschränkt", "Breaker offen", "Auth abgelaufen", "Deaktiviert", "Unbekannt"; until approval the draft words "Healthy"/"Degraded"); call status in German with the raw value in `title` (`ok` = "Erfolgreich", `tool_error` = "Tool-Fehler", `timeout` = "Timeout", `upstream_error` = "Upstream-Fehler", `rate_limited` = "Rate-Limit", `breaker_open` = "Breaker offen", `denied` = "Abgelehnt"); scope `mcp:tools` = "Tools auflisten und aufrufen", `mcpwarden:admin` = "Upstreams verwalten"; tool kind lesend / schreibend / löschend from `readOnlyHint` / `destructiveHint` (otherwise "unbekannt"); unit "Aufrufe" instead of "Calls".

## 8. Component list

**shadcn-vue (via `pnpm dlx shadcn-vue@latest add …`, all present in the docs):** `button`, `input`, `label`, `card` (0a), `table`, `dialog`, `alert-dialog`, `alert`, `badge`, `select`, `checkbox`, `radio-group`, `switch`, `tabs`, `tooltip`, `dropdown-menu`, `sheet`, `sidebar`, `skeleton`, `sonner`, `separator`, `breadcrumb`, `field`, `input-group`, `textarea`, `empty`, `spinner`, `scroll-area`, `toggle-group`, `collapsible`, `pagination`; phase 2 additionally `chart` (Unovis). `form` is **not** installed (docs: no longer developed).

| Need in the draft | Building block |
|---|---|
| Tables (upstreams, clients, tokens, audit, users, allowlist, statistics, tools) | `Table` in `DataSection` (card, title, description, horizontal scrolling, footer); real `<table>` with `caption` (sr-only), not CSS grid |
| Key figures | `KpiCard` (label, value, unit, note, optional status dot/bar) |
| Status | `StatusBadge` (chip with dot and text, props `status`, optional `reason`); `StatusDot` for client status |
| Time window 5 min / 1 h / 24 h / 7 d | `TimeWindow` on `ToggleGroup` (single selection, `aria-label`) |
| Auto-refresh | `AutoRefresh` (`Select`: off, 15 s, 30 s, 1 min) + `usePolling` |
| Bars "last 24" | `SparkBars` (24 `span`, `aria-hidden`, text alternative: "Letzte 24 Einträge: 22 ohne Fehler, 2 mit Fehlern") |
| Heatmap | `Heatmap` (7 × 24, `title` per cell, legend, table alternative via button "Als Tabelle anzeigen") |
| History charts | `chart` (Unovis) for `CallsChart`, `LatencyChart`; phase 2 |
| Error shares, result of the calls | `OutcomeBars` (label, bar, count; pure CSS) |
| Choosing a permission (tool mode, DCR mode, type, sign-in kind) | `RadioGroup` in outlined tiles (selected: border accent, background `--primary-tint`); type and sign-in-kind tiles as `RadioGroup`, not as a button with `aria-pressed` |
| Switches (tool active, stdio, instance) | `Switch` (the draft uses a checkbox; switch with label and `aria-checked`); stdio per user `Checkbox` |
| Confirmations | `AlertDialog` via `ConfirmDialog` (title, consequences, red button) for delete, revoke, ban, discard |
| Values visible once | `OneTimeSecret` (banner `role="status"`, value in `code`, `CopyButton`, closing deletes the value) |
| Secret input | `SecretField` (`InputGroup` with `type=password` and button "Anzeigen") |
| Empty / error / loading | `EmptyState` (`Empty`), `ErrorState` (message, error code, "Erneut versuchen"), `LoadingRows` (`Skeleton`) |
| Notifications | `Toaster` (sonner) for success/error of short actions; errors needing action stay in the content |
| Warning box | `Alert` with variants `warning`, `success`, `destructive` |
| Time | `RelativeTime` (`<time datetime>` with relative text, `title` absolute) |
| Consent | `ScopeList`, `ClientWarning`, `RedirectDisplay` (host bold, rest muted) |
| Slug | `SlugField` (input, live preview `<slug>__tool`, counter x/32, regex hint) |
| Form rows | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`, `FieldLegend` (docs confirm) |

Icons: the draft paths (24 × 24, stroke 1.8, round caps) are replaced by the icons of the library chosen in `components.json`; only if no suitable icon exists, store the draft's path in `components/common/icons/`.

## 9. Forms and validation

Technique: `vee-validate` (`useForm`, `Field` family) with zod schemas from `lib/zod-schemas.ts` (`toTypedSchema`, docs way; zod 4 compatibility via a spike in task 2, fallback schema error list directly in `FieldError`). Rules: client validation is a convenience, the server decides; server errors (`data.field`, `data.code`) are assigned to the field, unknown fields appear as an alert above the form. Error message on the field via `FieldError`, `data-invalid` on the `Field`, `aria-invalid` and `aria-describedby` on the input, focus on the first faulty field after submitting. Double-click protection: the submit button shows `Spinner` and is disabled (`aria-busy`). Unsaved changes: warning when leaving only in edit forms.

| Form | Fields and rules | Source of the rule |
|---|---|---|
| Sign in | Email (format), password (not empty) | 0a |
| Register | Name, email, password ≥ 12 (only if the server enforces it, E3), confirmation; on 403 message "Registrierung nur mit Einladung" | 0a, plan 1 |
| Accept invitation (`/invite/<token>`) | Name, email (prefilled and locked if the invitation is bound to an email), password ≥ 12, confirmation; token from the address, not as a form field; error pages for invalid, expired (7 days), already used | Decision 2, E13 |
| Upstream HTTP | Type; short-name slug `^[a-z0-9][a-z0-9-]{0,31}$` (unique: server 409); display name (not empty); URL `http(s)`, no userinfo; transport `auto/streamable/sse` (default `auto`, in "Erweitert"); sign-in kind `none/bearer/header` (`oauth` from phase 2, hidden before); for `bearer` secret; for `header` header name (token characters, **assumption** `^[A-Za-z0-9-]{1,64}$`) and secret | Spec P0-1, plan 1.1.6 |
| Upstream stdio | Command (not empty), arguments (list), `cwd` relative without `..`, env name/value pairs (value = secret, masked); field active only if `capabilities.stdio.allowed`, otherwise block reason from the API | Spec P0-5, plan 1.1.6, 1.3.5 |
| Upstream REST (phase 2) | Name, description, method, URL template with `{param}`, header/query/body templates, JSON schema (editor with parse check), secret reference, timeout, size limit | Spec P0-8 |
| Advanced (all) | Calls/min integer ≥ 1 (default 60), parallel ≥ 1 (default 5), timeouts connect/list/call in seconds (default 10/15/60), upper limits from the server (`limits`), **assumption** maximum 600 s | Spec P0-5, P0-14 |
| Replace secret | one field, required, cleared after success; no prefilling | Spec P0-6 |
| Create PAT | Name required, ≤ 64 characters; server limits to 20 active | Plan 0b task 5 |
| Auth link token | Secret required; "Testen" before "Speichern" optional | Spec P0-12 |
| Create invitation | Email optional (format; binds the invitation to this address), expiry fixed 7 days (no input field); result link `/invite/<token>` once | Spec P0-4, decision 2 |
| Consent | Switch `mcp:tools` (on, not deselectable), switch `mcpwarden:admin` (deselectable; not rendered until phase 2), mandatory checkbox for an unknown client | Decision 5 |
| User limits | `max_upstreams`, `calls_per_min`, `max_connections`, `stdio_max_procs`, `stdio_idle_min`, `stdio_allowed`; integers ≥ 1, default values from the API | Plan 1 section 4.2 |
| Allowlist entry | Label, name pattern, redirect patterns (line list; check patterns only for non-empty, `*` only as allowed by the server) | Plan 0b task 3 |
| SSRF exception | CIDR or hostname; hint on metadata IPs; server validates | Plan 1.1.5, W9 |
| Settings | Name; password change (current, new ≥ 12); appearance (only "Seitenleiste eingeklappt als Standard"; color scheme choice only after phase 2). No email field to change, no notification switches, no "Konto löschen" | Draft, W12, decisions 3 and 8 |
| Import (phase 3) | JSON text field or file; preview; secrets never expected | Spec P1 |

Deviation from the draft: the type and sign-in-kind tiles are `RadioGroup` (correct semantics and arrow keys), not buttons with `aria-pressed`.

## 10. Handling secrets in the UI

Rules (all testable):

1. **Never show:** response types contain no secret (contract rule 3). Stored secrets appear as "Gesetzt" (badge) with a button "Ersetzen"; the field starts empty.
2. **Memory only:** entered values live in the local form state, not in Pinia, `useState`, `localStorage`, `sessionStorage`, URL, route state or logs. On leaving the page, on sign-out and after success the value is overwritten (`''`).
3. **Input field:** `type="password"`, `autocomplete="new-password"` or `off`, `spellcheck=false`, the button "Anzeigen" acts only on the value just typed (like `AuthLink`). Example values (the draft has a prefilled token) do **not** exist in the UI and in the mock.
4. **One-time values (PAT, invitation link, link token):** `OneTimeSecret` holds the value only in the component state, offers copying, disappears on closing or navigating, is never output in toasts, error messages or `console`. The hint "Du siehst es nur einmal" stays visible.
5. **Error messages** never name the value; server messages are shown unchanged (the backend sanitizes them, plan 1.1.7).
6. **Link pages** (`/link/*`, `/invite/*`): `<meta name="referrer" content="no-referrer">` and `noindex`, the token is removed from the address bar after loading via `history.replaceState`, provided the server keeps the token in the session (question to phase 2; **unverified** whether the backend allows it).
7. **Tool descriptions and names** of the upstreams are untrusted: render as text only (no `v-html`), limit length, create no links.
8. **Canary test (E2E):** a unique secret value is entered, saved and all pages visited; afterwards the value must appear neither in the DOM, nor in responses (mock and real), nor in `localStorage`/`sessionStorage`/cookies, nor in the console.

## 11. Role-dependent visibility

Source of the role: `useSession()` from the Better Auth client (`user.role` from the `admin()` plugin; typing via the client plugin **unverified**). `useSessionUser()` encapsulates role, ban and sign-out.

| Area | User | Admin | Note |
|---|---|---|---|
| Navigation Betrieb, Zugang, Audit, Einstellungen | yes | yes | |
| Navigation group Admin and `/admin/*` | no (redirect `/` + hint) | yes | Server checks with `requireAdmin`; the UI only hides |
| Upstreams, tools, tokens, clients | own only | own only | Admin never sees foreign upstreams |
| stdio type in the form | active only with approval, otherwise blocked with reason | active if instance and capability | Reason from `capabilities.stdio.reason` |
| Admin hint box "Du siehst hier nur Metadaten" | – | on all admin pages | Spec P0-4 |
| Statistics | own figures | own figures + tab "Instanz" (aggregated, phase 2) | Spec P0-15 |
| Audit | own entries | own + instance events (e.g. user banned, setting changed) | decided 2026-11-04 (decision 6); server filters, UI only shows |
| Ban/delete users | – | yes, not the own account, not the last active admin (buttons disabled, server enforces) | Plan 1.1.10 |
| Consent scope `mcpwarden:admin` | Switch (deselectable) only from phase 2 if the client requests it; `mcp:tools` always on | same | The user's role does not influence the grant in the UI (decided 2026-11-04, decision 5); the server checks whether the user may receive the scope |

Rules: no knowledge from the frontend replaces a server check; 403 responses show a comprehensible page instead of an error dump. States change on a role change only after a new `get-session` (refresh on focus). In mock mode the `MockBanner` switches between admin and user and clears the page's data state.

## 12. Accessibility (basics)

The draft is already designed for it (44 px targets, labels, `aria-label`, status text next to color). Binding basics:

- Semantics: one `h1` per page, landmarks `nav` (labeled "Hauptnavigation"), `main`, `header`; real `<table>` with header cells `scope`; lists as `ul`.
- Keyboard: all actions via Tab, Enter, Space; dialogs trap focus (Reka UI), return it on closing; sidebar via Ctrl/Cmd+B (docs); skip link.
- Focus: visible ring (two pixels `--primary`, offset 2 px) on all controls; the draft shows none, hence mandatory in task 2.
- Tabs: the draft sets `role="tablist"` on pure link bars (admin areas, audit filters, time windows). That is wrong if no panels exist. Implementation: admin areas = navigation links with `aria-current`; detail tabs = `Tabs` with panels; time window and audit categories = `ToggleGroup` or `Tabs` with a single panel.
- Color: state always text plus shape (dot, chip, line style); charts with a text alternative (`role="img"` + `aria-label` as in the draft, additionally a table view).
- Forms: visible `Label` (`for`), help text via `aria-describedby`, errors `aria-invalid` + `FieldError`; required fields with text, not only an asterisk.
- Announcements: toasts and test results in `role="status"`, errors needing action `role="alert"`; loading states with `aria-busy`.
- Motion: transitions short, off with `prefers-reduced-motion`.
- Zoom and reflow: down to 320 px width without two-dimensional scrolling except tables; text scalable (rem).
- Contrast: values of the draft apply (text colors `#18181b`, `#3f3f46`, `#52525b` on white and `#f4f4f5`; status pairs); the result is checked with axe, the computation of the ratios was not done by hand (unverified).
- Language: `<html lang="de">`; technical terms in monospace stay untranslated.
- Check: axe-core per page in Playwright (mock), manual keyboard round per page, screen reader sample for consent, token link, tool table.

## 13. Mock strategy

Goal: the frontend is built before the backend phases and switches per domain to real routes without changing page code.

**Structure:**

- **Typed client** `app/api/*.ts`: thin functions over `$fetch` (ofetch) with the types from `#shared/api-types`; `http.ts` sets error mapping (`ApiError` with `statusCode`, `code`, `field`, `message`), redirects 401 to `/login`, throws a marked error on 403. Pages access only via `useApi()` composables, never via `$fetch` directly.
- **MSW handlers** `mocks/handlers/<domain>.ts` (from `msw/http`: `http`, `HttpResponse`), in-memory state `mocks/state.ts` with a seed from the draft data (`mocks/seed.ts`: 7 upstreams, 6 clients, 3 tokens, 3 users, 8 audit rows, allowlist with 7 entries). State is kept in `sessionStorage` and reset via the console helper `__mock.reset()`. Handlers follow the same rules as the backend (slug regex, limit 50, 409 on collision, `hasSecret` instead of secret, PAT plaintext only in the POST response, link only on creation).
- **Auth in the mock:** `/api/auth/sign-in/email`, `sign-up/email`, `sign-out`, `get-session` and the settings endpoints are emulated so that the real Better Auth client runs unchanged. Align the response shape with the real response from 0a (**unverified**, the contract test in task 4 reveals it). Role switch via `localStorage.mockRole`.
- **Scenarios** `mocks/scenarios.ts`: `localStorage.mockScenario` = `default | empty | error | slow | forbidden | huge`. They produce the empty, error, loading and 403 states without code changes; the `MockBanner` switches them.
- **Activation:** `VITE_API_MOCK=all` or a list (`auth,oauth,me`), set via `pnpm ui:dev` (mock, SPA) or not set (`pnpm dev`, real). In `nuxt.config.ts`: `ssr: !process.env.VITE_API_MOCK`. `plugins/msw.client.ts` starts the worker only when the variable is set (dynamic import, so that the production build does not contain it); `onUnhandledFrame: 'bypass'`, so that non-mocked domains reach the real server. Which domains are mocked is stated in one place (`mocks/index.ts`) and in the `MockBanner`.
- **Vite plugin or `msw init`:** task 4 clarifies in a short spike whether `msw/vite` (docs: delivers the worker) can be integrated into Nuxt without further ado; otherwise `public/mockServiceWorker.js` via `npx msw init` (command **unverified** for version 3).
- **Tests:** the same handlers run in Vitest via `setupServer` (`msw/node`, docs: setup file with `beforeAll/afterEach/afterAll`).

**Securing interchangeability (contract tests, `tests/ui/contract`):** for each route there is a zod schema (`satisfies z.ZodType<ResponseType>`, so that schema and type do not drift apart). The test calls (1) the mock handlers and (2) with `CONTRACT_BASE_URL` and a sign-in cookie set, the real server (built artifact from the backend harness). Both must pass the same schema. This way drift between mock and backend is noticed the moment a phase is finished.

**Switching per phase:** remove the domain from `VITE_API_MOCK`, run the contract test against the real server, repeat the page's E2E suite in real mode (task 18). Order of the domains in section 15.

## 14. Tasks

The order is binding where a dependency is named; otherwise a green intermediate state after every task (`pnpm ui:check` = typecheck + lint + `ui:test`). Every page is first finished against the mock (including empty, loading, error state and axe check), and only then switched to real routes.

### Task 1: Scaffold check, dependencies, scripts, boundaries
- Purpose: a workable state on branch `feat/frontend`, without conflicts with the backend agents.
- Starting point: only after the milestone "scaffold ready" of phase 0a (A2: end of 0a task 1). Before that no intervention in `package.json` and `nuxt.config.ts`.
- Files: `package.json` (only own dependencies and scripts `ui:dev`, `ui:test`, `ui:e2e`, `ui:check`), `nuxt.config.ts` (own keys), `.github/workflows/ui.yml`, `tests/ui/vitest.config.ts`.
- Steps: 1. Check the prerequisite: Nuxt scaffold from 0a (commit `chore: nuxt scaffold`, A2) present, otherwise wait or report back. Tailwind and shadcn-vue are set up by this task itself. 2. Pin the dependencies from section 2 exactly. 3. `nuxt.config.ts`: `ssr: !process.env.VITE_API_MOCK`, modules, `css`, Tailwind plugin, `shadcn`, `colorMode`. 4. Create scripts; `ui:dev` sets `VITE_API_MOCK=all`. 5. CI file `ui.yml` with typecheck, lint, `ui:test`, `ui:e2e` (Playwright against the `ui:dev` build). 6. Create directories per section 4. 7. In `README.md` (only the section "Frontend") rules on the ownership boundary.
- Check: `pnpm ui:dev` shows an empty page, `pnpm build` stays green.
- DoD: no diff in `server/**`; CI job runs.

### Task 2: Design tokens, fonts, base components, form library (spike)
- Purpose: capture the look of the draft in variables; clarify technical uncertainties early.
- Files: `app/assets/css/tailwind.css`, `components.json`, `app/components/ui/*` (variants), `app/lib/utils.ts`, `app/lib/zod-schemas.ts`.
- Steps: 1. Tokens from section 7 as CSS variables under `:root` (hex), `@theme inline` for Tailwind, `.dark` with empty placeholders. 2. Include fonts locally, no Google Fonts links. 3. Add the shadcn components from section 8; set `Button` (variants `default` = accent, `outline`, `destructive-outline`), `Input`, `Select` to 44 px and `rounded-sm`; add the focus ring. 4. Check the sidebar variables (248/64 px). 5. **Spike:** vee-validate + zod 4 (`toTypedSchema`); on failure document the fallback via the schema error list. 6. **Spike:** number format `formatNumber` (Intl output of the narrow space).
- Check: page "Styleguide" (mock mode only, route `/__styleguide`) shows colors, chips, typography, form rows; comparison with the boards `Main` and `Consent` by visual check.
- DoD: tokens complete; spike results added as a comment in `zod-schemas.ts` and in section 2.

### Task 3: Contract and API client
- Purpose: fix the boundary to the backend.
- Files: `shared/api-types.ts`, `app/api/*.ts`, `app/composables/useApi.ts`, `app/lib/labels.ts`.
- Steps: 1. Create the types from comparison section 5 (all routes, also phase 2/3, with the comment "phase n"). 2. `http.ts` with error mapping (section 13). 3. Module functions per domain. 4. `useApi` with `useAsyncData(..., { server: false })`, loading state, error, `refresh`. 5. Label tables (status, call status, scopes, tool kind) with raw-value fallback for an unknown enum. 6. Record in the README section: backend agents check with `satisfies`.
- Check: typecheck; unit test `labels` (every enum value has a label).
- DoD: contract checked in, backend agents informed.

### Task 4: Mock layer and contract tests
- Purpose: development without a backend (F2, F3).
- Files: `mocks/**`, `app/plugins/msw.client.ts`, `tests/ui/contract/*`.
- Steps: 1. Spike MSW 3 in Nuxt (Vite plugin or `msw init`); result as a comment in `msw.client.ts`. 2. State, seed, scenarios. 3. Handlers per domain (order: auth, me, oauth, admin-oauth, upstreams, admin, audit, dashboard, stats, links). 4. Random delay 150 to 500 ms, can be switched off. 5. Contract schemas and tests (mock always, real optional).
- Check: `pnpm ui:dev` runs; sign in with the seed account; all routes from section 5 deliver data; `ui:test` green; scenarios produce the states.
- DoD: no seed secret in the mock (test); role switchable.

### Task 5: Layout, navigation, guards, error pages
- Purpose: shell of all pages (section 6).
- Files: `app/app.vue`, `layouts/{default,auth}.vue`, `components/shell/*`, `middleware/{auth.global,admin}.ts`, `composables/{useSessionUser,useSidebarState,useAttentionCount}.ts`, `lib/nav.ts`, `error.vue`.
- Steps: sidebar structure, collapsed state with cookie, mobile, user menu, skip link, `PageHeader`, `AdminTabs`, `MockBanner`, toaster, guards including the `redirect` query and preserving the OAuth query.
- Check: component test navigation per role; E2E: collapsing persists after reload; keyboard Ctrl+B; 375 px view; axe.
- DoD: F5, F7, F8 met for the shell; `DashboardCollapsed` and `Dashboard` yield the same page frame.

### Task 6: Shared building blocks
- Purpose: reuse instead of one-off builds.
- Files: `components/common/*`.
- Steps: building blocks from section 8 with props types, states, tests; `StatusBadge` knows all five health values plus `unknown` and `setup` states; `SecretField` and `OneTimeSecret` keep the rules from section 10; `SparkBars` and `Heatmap` with a text alternative.
- Check: component tests (rendering, keyboard, accessibility with axe matcher), extended styleguide page.
- DoD: every building block in the styleguide with all states.

### Task 7: Auth pages (login, registration, invitation, consent)
- Purpose: entry and OAuth consent (P0-2, P0-4). **Real from 0a (login, registration), phase 1 (invitation), 0b (consent).** These pages are frontend tasks; the backend phases no longer build them (decision 1, A3) and deliver only API and tests.
- Files: `pages/{login,register,consent}.vue`, `pages/invite/[token].vue`, `layouts/auth.vue` (from task 5), `components/access/{ScopeList,ClientWarning,RedirectDisplay}.vue`, `lib/auth-client.ts`.
- Subtasks:
  - **7a Login (`/login`)**: `Field` form email and password, error texts (wrong credentials, banned user), `redirect` query, continuation of the signed OAuth query unchanged (0b R14), link "Registrieren" only if registration is open (otherwise hint "nur mit Einladung").
  - **7b Registration (`/register`)**: name, email, password, confirmation; on 403 message "Registrierung nur mit Einladung" (the first user becomes admin, afterwards closed, 0a O1).
  - **7c Accept invitation (`/invite/<token>`)**: loads `GET /api/invites/:token`; valid → registration form, email prefilled and locked if the invitation is bound to an address; invalid, expired (7 days) or used → error page with a hint to contact the admin; token never in a form field, toast or log (section 10 rule 6); on success redirect to `/`.
  - **7d Consent (`/consent`)** per the `Consent` draft: header, `ClientWarning` only with `allowlisted=false`, mandatory checkbox unlocks "Zugriff erlauben"; known client without warning; error page for an invalid signature; loopback extra warning; redirect host bold; two switches: `mcp:tools` (always on, not deselectable) and `mcpwarden:admin` (deselectable, not rendered until phase 2); scope titles from the label table, raw scope in monospace; the chosen scope subset goes to the server; declining leads back to the client (`access_denied`).
- Check: E2E in the mock (all consent variants, invitation valid/bound/expired/used); against real after 0a/0b: sign in, register (first user), consent with Claude Code manually; after phase 1: accept an invitation link.
- DoD: F1 for the four boards; F13, F14; keyboard and axe green.

### Task 8: Personal pages (settings, tokens, clients)
- Purpose: P0-3, revocation, account. **Real from 0b (tokens, clients), 0a (settings).**
- Files: `pages/settings/{index,tokens,connections}.vue`, `components/access/{PatTable,ConnectionTable}.vue`.
- Steps: 1. Tokens: create dialog (name), `OneTimeSecret` banner after success, table (name, beginning `mcpw_pat_` + 4, created, last used, status), revocation with `ConfirmDialog`, empty state, limit hint. 2. Clients: table (client, authorized, last connected, permission as title), revocation with the hint "wirkt beim nächsten Aufruf", empty state; card "Was Clients sehen" visible only if phase 3 is active (feature flag from `capabilities`). 3. Settings: profile (name), password, web sessions, appearance (only sidebar collapsed as default; the color scheme choice "System"/"Dunkel" stays hidden until after phase 2, decision 8), no email change, no mail notifications, no self-deletion (dropped, decision 3).
- Check: component and E2E tests in the mock; canary test PAT; after 0b against real (isolation: a second mock/real user sees nothing foreign).
- DoD: pages cover `Tokens`, `Clients`, `Settings` as far as spec and plan support it.

### Task 9: Admin clients (DCR)
- Purpose: P0-2 policy, allowlist, registrations. **Real from 0b.**
- Files: `pages/admin/oauth.vue`, `components/admin/{AllowlistTable,AllowlistDialog,ClientRegistrations}.vue`.
- Steps: radio group (Aus / Nur Allowlist / Offen mit Warnung, default Offen), hint text "Allowlist ist Komfort und Warnlogik, kein Sicherheitsmerkmal" (0b task 3), allowlist table with entry dialog and removal, registration table (name, redirect URIs, created, last used, users, allowlist status, expiry), revocation with confirmation.
- Check: E2E mock; after 0b against real (non-admin gets the 403 page).
- DoD: `AdminClients` complete including empty/error states.

### Task 10: Upstreams (list, create, edit, detail)
- Purpose: P0-5, P0-6, P0-7, P0-14 (display). **Real from phase 1 (milestones 1.1 and 1.2).**
- Files: `pages/upstreams/{index,new}.vue`, `pages/upstreams/[id]/{index,edit}.vue`, `components/upstreams/*`.
- Steps: 1. List: filter (search, status, type; without tags, dropped), status cards, table with abbreviation, name, URL/command, `StatusBadge`, type, tools "aktiv / gesamt", p95 and `SparkBars` only if the API delivers them (otherwise the column is hidden), message, actions (test, edit); "+ Upstream hinzufügen"; "JSON importieren" only phase 3; "Alle testen" not built (later with confirmation and rate hint, task 16); no device names. 2. Create/edit: form per section 9, hint per sign-in kind, secret field, `SlugField`, "Anlegen und verbinden" calls create, secret, test in sequence and shows `TestResult` (tools or error text). 3. Detail: header with actions (test, disable, edit, delete with confirmation); tabs Übersicht (details, warning box from `statusReason`, key figures as far as delivered), Tools (`ToolTable`: name, description as text, kind badge, switch takes effect immediately with optimistic display and rollback on error), Auth (state "Gesetzt", "Ersetzen", for OAuth expiry and button "Neu verbinden" from phase 2); left list of the upstreams with search (draft) as a toggleable side column. 4. States: empty ("Noch kein Upstream" with steps), loading, error, `unknown`, `setup`.
- Check: E2E mock (create ≤ 2 minutes, stop acceptance 7 of the spec manually), canary test, foreign ID yields a 404 page; against real after 1.1.8 and 1.2.2.
- DoD: `Main`, `UpstreamNeu`, `Detail` (without curves) implemented; a tool change is visible without reloading.

### Task 11: Admin users, invitations, instance
- Purpose: P0-4 and admin settings. **Real from phase 1 (1.1.9, 1.1.10, 1.3.5).**
- Files: `pages/admin/{users,settings}.vue`, `components/admin/{UserTable,InviteDialog,LimitsDialog,SsrfList}.vue`.
- Steps: 1. User table (user, role, upstreams "x / limit", last activity, stdio checkbox, actions ban/unban, limits, delete with double confirmation including a list of consequences), banned state, protection for the own account and the last admin. 2. Invitations: create (optional email binding, validity fixed 7 days), result banner `OneTimeSecret` with link `/invite/<token>`, list of open invitations with expiry and revocation. 3. Instance: switch `stdio.enabled`, SSRF exception list (table, no boolean), registration only by invitation (token link, decision 2; no separate "Allowlist" switch); hint on the effect (stdio "führt Code auf dem Host aus").
- Check: E2E mock; after phase 1 against real, non-admin 403.
- DoD: `Admin`, `AdminInstanz` complete including the states added in the comparison.

### Task 12: stdio in the form, block reasons, approval page
- Purpose: P0-5 approval, P0-12 draft. **Real from 1.3 (form, reasons), phase 2 (approval page).**
- Files: `components/upstreams/{StdioFields,SetupHint}.vue`, `pages/upstreams/[id]/approve.vue`.
- Steps: form fields per section 9, block reasons from `capabilities`, approval page per `StdioFreigabe` (command in monospace, path from the server, origin, checklist from API fields instead of fixed, discard, "Freigeben"; text "startet beim ersten Aufruf"), display "wartet auf Freigabe" in list and detail.
- Check: mock scenarios for each block cause; E2E.
- DoD: all four block reasons visible; board `StdioFreigabe` implemented.

### Task 13: Dashboard and audit
- Purpose: overview (decision 4) and P0-12/P0-14 audit. **Real from phase 1 (clients, attention, audit reading; routes `/api/dashboard` without KPIs and `/api/audit`, E11, decided 2026-11-04), KPIs and chart phase 2.**
- Files: `pages/index.vue`, `pages/audit.vue`, `components/common/KpiCard.vue` (usage).
- Steps: 1. Dashboard: empty state with MCP URL and setup command; key figures (only if delivered); table "Verbundene Clients" with "Aktiv/Inaktiv" (last call < 5 min), "Zuletzt aktiv", calls/min, context size (without device names, dropped); revocation (OAuth: connection, PAT: token); card "Braucht Aufmerksamkeit" with a link to the detail and a reconnect button for `auth_expired`; chart calls/min (phase 2). 2. Audit: categories as a switcher (category "Anmeldung" only if the API delivers it), table with time, client, action, target, result; users see their own entries, admin additionally instance events (server filters, decision 6); cursor paging ("Mehr laden"); empty state.
- Check: E2E mock including "nothing to do"; axe.
- DoD: `Dashboard`, `DashboardCollapsed`, `Audit` implemented; texts follow comparison W4, W7.

### Task 14: Statistics and history curves
- Purpose: P0-15 display. **Real from phase 2.**
- Files: `pages/stats.vue`, `components/stats/*`, extension of `pages/upstreams/[id]/index.vue`.
- Steps: `shadcn-vue add chart`; page per `Statistik` (window 5 min/1 h/24 h/7 d, upstream and tool filter, five key figures, calls/hour, result of the calls, percentile table p5/p50/p75/p95/p99 + overhead p95); detail: percentile table with all five values, `LatencyChart`, errors by kind, availability and heatmap only with an existing `health-history` (otherwise the cards are not rendered, decision 7); admin tab "Instanz".
- Check: component tests with fixed data (axis scales!), E2E mock, text alternatives.
- DoD: `Statistik` and the curves of `Detail` implemented; the Y axes match the values (comparison item 27).

### Task 15: Link pages, REST editor, upstream OAuth
- Purpose: P0-12, P0-8, P0-13. **Real from phase 2.**
- Files: `pages/link/{[token],done}.vue`, `components/upstreams/RestFields.vue`, adjustment of `SetupHint`.
- Steps: token/header page per `AuthLink` (with error states: expired, used, foreign user, test failed), OAuth return (`connected`, `unsupported`, `error`), REST editor per section 9, sign-in kind OAuth in the form, button "Neu verbinden", scopes in the auth tab; consent: show the switch `mcpwarden:admin` (decision 5).
- Check: E2E mock, canary test link token, referrer and `noindex` headers checked.
- DoD: `AuthLink` complete; REST tools can be created in the mock.

### Task 16: Phase 3 functions
- Purpose: tool mode, import/export, templates; also the elements postponed to later (decisions 7 and 8). **Real from phase 3.**
- Files: `pages/settings/connections.vue` (tool mode), `components/upstreams/ImportDialog.vue`.
- Steps: tool mode choice with effect text; import as a dialog (preview, error per entry, never secrets), export without secrets; template list; switch "Aufrufe" tab as soon as the call log exists. Later and not part of the acceptance of phases 1 and 2: "Alle testen" in the upstream list with a confirmation dialog and rate hint (the test counts against rate limit and breaker); dark mode after phase 2 (add values for `.dark`, show the choice System/Hell/Dunkel in the settings, repeat the axe contrast check).
- Check: E2E mock.
- DoD: `Clients` (tool mode) and import covered; "Alle testen" and dark mode only if scheduled in time.

### Task 17: Hardening (accessibility, responsive, performance)
- Purpose: F6, F7, F10 across the board.
- Steps: axe over all routes and states, manual keyboard round, screen reader sample, widths 320/375/768/1440, focus order, number and time formats, load time (no blocking by charts: `chart` via dynamic import), bundle size, removing the mock code from the production build (test: `pnpm ui:check-build` checks file names and content of `.output` for the worker file, `INTEGRITY_CHECKSUM`, `startMock`, `setupWorker`, seed code; in CI after `pnpm build`; mock builds write to `.output-mock`).
- Check: `ui:e2e` green, report in the PR.
- DoD: no axe violations "serious"/"critical"; checklist of section 12 ticked.

### Task 18: Switching to real routes and acceptance (repeated per phase)
- Purpose: F9.
- Steps: per phase remove the domains from section 15 from `VITE_API_MOCK`, contract tests against the built backend, E2E suite in real mode (harness server from `tests/integration`, **used read-only**), report deviations as a change to the contract or as a bug to the backend agent (do not fix in `server/` yourself), update section 3 of this plan with real findings.
- DoD: for the phase all related pages run without a mock; log in `docs/manual-tests/frontend-<phase>.md`.

## 15. Order and real-data schedule

| Time | Frontend work | Runs against real data |
|---|---|---|
| Preparation (before "scaffold ready") | only contract `shared/api-types.ts`, mock draft, labels; no intervention in `package.json`/`nuxt.config.ts` | nothing |
| immediately after the milestone "scaffold ready" (end of 0a task 1, A2) | Tasks 1 to 6; pages of tasks 7 to 16 against the mock, in this order | nothing |
| after 0a (backend tasks 8 and 9) | Task 18 for `auth`; task 7a/7b (login, registration; the backend delivers only API), part of task 8 (settings: name, password, sessions) | `/login`, `/register`, session, role, `/settings`, shell with navigation by role |
| after 0b | Task 18 for `oauth`, `me`, `admin-oauth`; tasks 7 (consent), 8, 9 | `/consent`, `/settings/tokens`, `/settings/connections`, `/admin/oauth` |
| after phase 1, milestone 1.1 | Task 10 (CRUD, test, secret), task 11 (including invitations as a token link); task 7c (accept invitation); task 18 for `upstreams`, `admin` | `/upstreams`, `/upstreams/new`, `/upstreams/[id]/edit`, `/admin/users`, `/admin/settings`, `/invite/<token>` |
| after phase 1, milestone 1.2 (expectation: routes `/api/dashboard` without KPIs and `/api/audit` are part of phase 1, E11; decided 2026-11-04) | Tool switch, status, status cards, limit hits; task 13 (dashboard: clients table and attention without KPIs; audit reading with user/admin view) | Tools tab, status display, `/` (clients, attention), `/audit` |
| after 1.3 | Task 12 (stdio form, block reasons) | stdio in the form |
| after phase 2 | Tasks 13 (KPIs, chart), 14 (availability and heatmap only with `health-history`), 15 (consent switch `mcpwarden:admin` visible); then dark mode (task 16) | `/stats`, curves, `/link/*`, approval page, REST editor, OAuth upstream, admin scope in the consent |
| after phase 3 | Task 16 (tool mode, import; "Alle testen" with confirmation and rate hint) | Tool mode, import |

Parallelism: tasks 7 to 9 depend only on 3 to 6; 10 and 11 are independent afterwards; 13 to 16 are independent, except for the use of the building blocks from 6.

## 16. Test strategy

- **Unit** (Vitest): `labels`, `formatNumber`, `RelativeTime`, zod schemas (slug table with edge cases: 32 characters, `__`, uppercase, hyphen at the start), `nav` per role.
- **Component** (Vitest + `@vue/test-utils`, MSW `setupServer`): `StatusBadge`, `SecretField`, `OneTimeSecret`, `ConfirmDialog`, `UpstreamForm` (all sign-in kinds), `ToolTable` (optimistic switch, rollback), `ClientWarning`.
- **Contract** (section 13): mock always, real with `CONTRACT_BASE_URL` set.
- **E2E** (Playwright against the `ui:dev` build, mock): main paths per board, all scenarios (`empty`, `error`, `forbidden`, `slow`), role switch, collapsing, 375 px, canary secret test, axe per page. After every phase the same suite in real mode against the built backend (task 18).
- **Visual comparison:** screenshots of the pages at 1440 px next to the boards (manual, no pixel equality required); deviations are justified in the PR.
- **Not tested in the frontend:** authorization logic of the backend, tenant isolation (lies in the isolation tests of the backend phases); the frontend only checks that it reacts cleanly to 403/404.

## 17. Risks

| Risk | Effect | Countermeasure |
|---|---|---|
| R1 Drift between mock and backend | Pages break on switching | shared types, contract tests, contract change only with a mock adjustment in the same commit |
| R2 Two page families (backend plans still build Vue files although the frontend takes over all `app/**` files, decided 2026-11-04) | duplicate work, style breaks, merge conflicts in `app/**` | backend plans drop their Vue tasks (0a task 9, 0b tasks 3 to 5, phase 1 tasks 1.1.8 to 1.1.10, 1.3.5; only API, tests, contract contributions remain); until then ask the backend agents not to create `app/**`; the frontend builds login and registration (task 7) |
| R3 MSW 3 cannot be integrated into Nuxt dev without further ado | no mock | Spike task 4; fallback: own small mock server (Node, `h3`) with the same handlers and proxy via `routeRules` (docs: `routeRules` exists, marked experimental) |
| R4 Better Auth response shapes in the mock are wrong | login flow deviates | compare the mock auth early against the real 0a artifact; contract test |
| R5 Sidebar details (persistence, icon width, mobile) unverified | deviation from the draft | task 5 checks in the browser; own persistence via cookie |
| R6 vee-validate/zod 4 compatibility | forms without type checking | Spike task 2, fallback via the standard-schema error list |
| R7 The draft does not cover many states (empty, error, loading, dialogs, variant stdio/REST) | inconsistent one-off builds | building blocks from task 6 are the only source; texts in the glossary; review with the draft's author |
| R8 Tables and charts with data that no plan delivers (availability, heatmap, devices, tags) | dead UI | columns/cards appear only if the API delivers the field; otherwise hidden; tags and device names are dropped, availability and heatmap only with `health-history` (decision 7) |
| R9 XSS through upstream texts, client names | data leak | text interpolation only, no `v-html`, truncate lengths, lint rule `vue/no-v-html` |
| R10 Secret ends up in the browser via devtools, error reports or logs | disclosure | rules of section 10, canary test, no error reporting with form state |
| R11 SSR cookie forwarding and hydration errors | flickering pages | data fetching client-only (A5), auth pages SSR only with `useSession(useFetch)` |
| R12 Polling creates load (auto-refresh, many cards) | slow gateway | default "off" or 30 s, pause with a hidden tab, bundled routes instead of many single calls |
| R13 Accessibility suffers from the draft (roles `tablist`, `aria-pressed`, CSS-grid-only tables) | violations | sections 8, 9, 12 implement the countermeasures; axe in CI |
| R14 Mock code gets into the production build | misbehavior, leak of the seed data | dynamic import behind a variable, test on the build output (task 17) |
| R15 Shared files (`package.json`, `nuxt.config.ts`) create merge conflicts | friction | own keys, small commits, keep the order 0a, 0b, phase 1; start only after "scaffold ready" (A2), no change to either file before |
| R16 Phase 1 does not yet deliver `/api/dashboard` and `/api/audit` (plan 1 moves both to phase 2, decision 4 requires them in phase 1) | dashboard and audit stay in the mock until phase 2 | wish E11 to the phase 1 agent; as long as the route is missing, the domain `dashboard`/`audit` stays in `VITE_API_MOCK` and the schedule row shifts |
| R17 Invitation model: plan 1 knows an email allowlist without token, the token link is decided (decision 2) | `/invite/<token>` has no backend, admin page does not fit | E13 to the phase 1 agent; mock handlers follow the token model, contract test shows the deviation |
| R18 Consent with a scope subset (decision 5) may not be supported by the Better Auth consent (unverified) | admin switch ineffective or error | build the switch in only from phase 2; clarify beforehand with the 0b agent whether the consent accepts a scope list |

## 18. Unverified (collection)

Not confirmed against official sources: cookie or storage persistence, `--sidebar-width-icon` and mobile behavior of the shadcn-vue sidebar; derivation factors of `--radius` in the generated build; which icon package `shadcn-vue init` 2.9.0 chooses (`lucide-vue-next` or `@lucide/vue`); import paths of `@fontsource-variable/*`; compatibility of `@vee-validate/zod` 4.15.1 with zod 4.6.7; API names of `@vueuse/core` 15 (`useIntervalFn`, `useDocumentVisibility`, `useClipboard`); browser setup of MSW 3 in Nuxt, command `msw init` in version 3, Vite plugin `msw/vite`; response shapes and function names of the Better Auth session endpoints (`update-user`, `change-password`, `list-sessions`, `revoke-session`) and the typing of `user.role` in the Vue client; `history.replaceState` behavior for link tokens during a running session; derivation of the accent tint via `color-mix`; contrast ratios of the draft colors; patterns of the allowlist (Claude web callback, Cursor, Zed); Intl output of the thousands separator; whether the Better Auth consent accepts a subset of the scopes (decision 5); whether `phase-0a.md` covers the milestone "scaffold ready" with tasks 1 and 2 (A2, expectation, not documented); whether phase 1 actually takes up `/api/dashboard`, `/api/audit` and the token invitation model (E11, E13).
