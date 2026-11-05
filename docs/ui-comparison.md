# UI comparison: drafts against spec v0.4 and backend plans

As of: 2026-11-04 · Source of the drafts: Claude artifact `EXj4fJ9FsvkUjZ3o5hVEcM`, folder `project/` (16 boards, version `1793826323-7d61`) · Spec: `docs/spec.md` v0.4 · Plans: `docs/plans/phase-0a.md`, `phase-0b.md`, `phase-1.md` · Follow-up document: `docs/plans/frontend.md`

Language: this document is English; the drafts and the product UI are German, so UI labels are quoted in German ("Dashboard", "Widerrufen", …).

Reading aid: **Phase** names the backend phase that must deliver data or function. There is no plan yet for phases 2 and 3; there it says "Plan: no". Statements about library versions are in the frontend plan.

## 1. Screen inventory

Common shell (dashboard, main, detail, statistics, clients, tokens, audit, admin*, settings): left sidebar with logo "m", groups **Betrieb** (Dashboard, Upstreams with counter badge "3", Statistik), **Zugang** (Clients, Tokens), **System** (Audit, Admin), at the bottom Einstellungen, user block (initials, name, email) and "Einklappen". Width 248 px expanded, 64 px collapsed (icons only, the group heading becomes a line, the badge becomes a dot, `title`/`aria-label` per link). Below 700 px width the sidebar becomes a horizontal bar. Header per page: breadcrumbs "Home › …", `h1`. The accent is selectable as a property (default `#3730a3`). Only the collapse switch is interactive; links point to the other boards.

| Board | Purpose | Main elements | States (shown / missing) | Data and fields | Actions |
|---|---|---|---|---|---|
| `Dashboard` | Overview: who is connected, what needs attention | 4 key figures (clients online "4 von 6", calls/min, success rate, gateway overhead p95 with target ≤ 50 ms); table "Verbundene Clients" (name, device, sign-in OAuth/Token, status Online/Inaktiv, "seit", rate, "Tools im Kontext" in tokens); card "Braucht Aufmerksamkeit" (3 upstreams with status and message); line chart calls/min | shown: filled, badge "nicht in Allowlist" per client. Missing: empty (new instance, no clients), loading, error, "nothing to do" in the attention card | Client: name, subtitle, sign-in kind, status, timestamp, calls/min, context size; upstream: name, status, message | Dropdowns "Letzte Stunde", "Auto-Refresh"; "Widerrufen" per client; link "Alle Clients und Tokens"; row in "Aufmerksamkeit" → detail |
| `DashboardCollapsed` | like `Dashboard`, sidebar collapsed | identical; only `collapsed=true` | shows only the narrow sidebar | – | – |
| `Main` (upstreams) | List and overview of all upstreams | Filter row (search, status, type, tags); 5 status cards with bars (Healthy 3, Degraded 1, Breaker offen 1, Auth abgelaufen 1, Deaktiviert 1); table: name with abbreviation and URL/command, status chip, type (http/stdio/rest), tools "aktiv / gesamt", p95, 24 bars "Letzte 24 Aufrufe", message | shown: all 5 statuses, footer "Zeige 1–7 von 7 · 10 pro Seite". Missing: empty (no upstream), loading, error, filter without hits, state "waiting for auth/approval" | see columns; counter per status | "Letzte 7 Tage", "Auto-Refresh", filters, "Alle testen", "JSON importieren", "+ Upstream hinzufügen", per row "Verbindung testen" and "Bearbeiten" |
| `Detail` (upstream) | Single view of an upstream (example `linear`, degraded) | List of all upstreams on the left (search, status, 24 bars); header with status chip; tabs Übersicht/Tools/Auth/Aufrufe (only Übersicht worked out); 5 key figures (p50, p95, overhead p95, error rate, calls/min); card Details (type, URL, auth "OAuth, verbunden · läuft in 6 Tagen ab", rate limit "60 / min · 5 parallel", timeouts "10 s · 15 s · 60 s") with warning box; card "Status, letzte 24 Stunden" (24 bars, "Verfügbar 91,7 %", heatmap 7 days × 24 h with legend); line chart p50/p95/p99; "Fehler nach Art" (timeout, upstream error, rate limit, breaker open with count and average duration); tool table (name, description, kind read-only/writing/deleting, errors, p95, switch active) | shown: degraded. Missing: tabs Tools/Auth/Aufrufe, healthy/open/auth_expired/disabled, loading, error, result of "Verbindung testen", dialog "Löschen" | see cards | "Verbindung testen", "Deaktivieren", "Bearbeiten", "Löschen", time window, auto-refresh, tool switch (takes effect immediately) |
| `UpstreamNeu` | Create upstream (example `sentry`, OAuth) | Type tiles HTTP / stdio ("braucht Freigabe") / REST; name; server URL; sign-in Keine/Bearer/Header/OAuth with hint "kein Secret hier"; expandable "Erweitert": calls/min 60, Parallel 5, timeout per call 60 s; link "mcpServers-JSON importieren" | shown: HTTP + OAuth. Missing: forms for stdio and REST, header name, secret field for Bearer/Header, validation errors, loading while creating, blocked stdio with reason | name, url, authType, rate_per_min, max_concurrent, call timeout | "Anlegen und verbinden", "Abbrechen", import link |
| `StdioFreigabe` | Review the draft of a stdio upstream created via MCP | Title "duckdb wartet auf Freigabe", alert box "startet einen Prozess auf dem Server"; command (monospace), working folder, environment, network hint; checklist (3 items) | shown: approval possible. Missing: stdio globally off, account not approved, container without capabilities, image `slim` | command, args, cwd, env names, origin (client, time) | "Verwerfen", "Freigeben und starten" |
| `AuthLink` | Link page: enter token (from `add_upstream`) | Card: upstream, URL, auth "Bearer-Token"; password field with "Anzeigen"; hint "nie wieder angezeigt, nur ersetzen"; success message "14 Tools gefunden"; footer "zurück ins Coding-Tool"; "Link läuft in 14 Minuten ab, gilt nur einmal" | shown: test successful. Missing: test failed, link expired/used, foreign user (403), header variant (with header name), OAuth return page "verbunden" and "nicht unterstützt" | upstream, url, authType, remaining time | "Testen", "Speichern", "Anzeigen" |
| `Consent` | OAuth consent for an unknown DCR client | Header "Zugriff erlauben?", "Angemeldet als …"; warning box "nicht in der Allowlist" (name, redirect, "Registriert vor 2 Minuten per DCR"); permission list (`mcp`, `mcpwarden:admin` with explanation); mandatory checkbox; footer "jederzeit unter Clients widerrufen" | shown: unknown client. Missing: known client (without warning and without mandatory checkbox), error (signature invalid), loopback extra warning, button disabled until ticked | client.name, redirect_uris, registered-at, allowlisted, scopes | "Ablehnen", "Zugriff erlauben" |
| `Statistik` | Key figures per time window | Window choice 5 min/1 h/24 h/7 d; "Alle Upstreams" filter; 5 key figures (total, per minute, success rate, peak simultaneous, active clients); columns calls/hour; "Ergebnis der Aufrufe" (7 statuses as bars); table per upstream: calls, success, p5, p50, p75, p95, p99, overhead p95 | shown: 24 h. Missing: empty, loading, error, filter per tool, average/max duration | see table | Window change, upstream filter, link to detail |
| `Clients` | Authorized clients and tool mode | Card "Was Clients sehen": Direkt / Meta-Tools (radio); table: client, device, authorized, last connected, permission ("Tools", "Tools und Verwaltung") | shown: 5 clients. Missing: empty, confirmation before revocation | client, sub, since, last, scope | Radio, "Widerrufen" |
| `Tokens` | Personal access tokens | "+ Token erzeugen"; green banner row with plaintext once and "Kopieren"; table name, "Beginnt mit", created, last used | shown: freshly created. Missing: dialog "Token benennen", empty, limit reached (20), confirmation before revocation | name, prefix, created, lastUsed | "+ Token erzeugen", "Kopieren", "Widerrufen" |
| `Audit` | Audit log | Tabs Alle/Verwaltung/Anmeldung/Status/Abgelehnt; table time, client, action (monospace), target, result (Erfolgreich, Wartet auf Freigabe, Abgelehnt, Statuswechsel) | shown: 8 rows. Missing: empty, paging, time-range filter, loading | ts, client, action, target, result | Tab filter |
| `Admin` (tab Nutzer) | Users and invitations | Tabs Nutzer/Clients (DCR)/Instanz; hint "nur Metadaten"; "+ Einladung erzeugen"; green row with invitation link (single use, 7 days); table user, role, upstreams "x / 50", last activity, stdio allowed (checkbox), "Sperren" | shown: 3 users. Missing: delete, banned state/"Entsperren", confirmation dialog, list of open invitations, per-user limits | email, role, upstreamCount, lastActivity, stdioAllowed | Create/copy invitation, checkbox, "Sperren" |
| `AdminClients` | DCR policy, allowlist, registered clients | Radio group Aus / Nur Allowlist / Offen mit Warnung (default); allowlist table (7 entries with redirect patterns, "✕"); table "Registrierte Clients" (name, redirect URIs, created, last used, users, "In Allowlist", expiry in 24 days, "Widerrufen") | shown: 4 clients. Missing: dialog "+ Eintrag", empty, confirmations | see spec P0-2 | Mode, "+ Eintrag", "✕", "Widerrufen" |
| `AdminInstanz` | Instance switches | 3 switches: stdio global, relax SSRF protection, registration via allowlist | shown: stdio on | 3 booleans | Switches |
| `Settings` | The user's account | Profile (name, email), password (minimum 12 characters), web sessions (3, "Abmelden"), appearance (System/Hell/Dunkel, sidebar collapsed as default), email notifications (3 switches), delete account | shown: default. Missing: error/success per section, dialog "Konto löschen" | name, email, sessions, theme, notification flags | "Speichern", "Passwort ändern", "Abmelden", radio, checkboxes, "Konto löschen" |

`canvas.json` only fixes the arrangement of the 16 boards; the note mentions "shadcn-vue zinc, Radius 6/10, Inter" and "Statusfarben tragen immer auch ein Textlabel" (status colors always also carry a text label).

## 2. Coverage spec → UI

Symbols: **yes** = draft exists and is complete enough, **partly** = draft exists, parts missing (column "Gap"), **no draft**.

| Spec | Requirement with UI | Draft | Gap / note |
|---|---|---|---|
| Entry (goal 1, US 1) | User finds the MCP URL `https://<host>/mcp` and a setup command | no draft | Empty state of the dashboard: URL, copy button, example `claude mcp add --transport http …`, PAT variant (0b plan, task 11) |
| P0-2 Login | `/login`, `/register` (first user = admin) | no draft | required by 0a; also registration with invitation, error texts (403 closed), redirect with signed OAuth query |
| P0-2 Consent | Consent with warning for unknown clients, active confirmation | partly (`Consent`) | known client, error page, loopback warning, scope names |
| P0-2 DCR admin | Mode off/allowlist/open, maintain allowlist | yes (`AdminClients`) | dialog "+ Eintrag" missing |
| P0-2 Clients | Admin: registrations with name, redirect URIs, created, last used, user count, revocation, expiry 30 d | yes (`AdminClients`) | confirmation before revocation |
| P0-2 / US | User: per client last connected, revoke individually | yes (`Clients`, `Dashboard`) | dashboard and clients overlap (see section 3) |
| P0-3 | Create PAT, name, revoke, plaintext once, last used | partly (`Tokens`) | create dialog, empty state, limit 20 (0b plan) |
| P0-4 User management | Invitation (link, single use, expiring), list, ban, delete, metadata only | partly (`Admin`) | delete, unban, confirmation, open invitations, accept page of the link |
| P0-4 Per-user limits | Upstreams (50), connections, calls/min, stdio approval, changeable by admin | partly (`Admin`) | only stdio checkbox and "x / 50" (not editable); rest no draft |
| P0-5 Upstream CRUD | create, change, delete, disable, test (tools or error) | partly (`Main`, `UpstreamNeu`, `Detail`) | edit form, delete dialog, test result panel, stdio form |
| P0-5 stdio approval | Only with admin approval; UI names the reason for a block | partly (`StdioFreigabe`, `Admin`) | block reasons ("Admin", "container without capabilities", "supervisor unreachable", "image slim") missing |
| P0-5 Rate limit per upstream | 60/min, 5 parallel adjustable, hits in the status | yes (`UpstreamNeu`, `Detail`) | hits only as a row in "Fehler nach Art" |
| P0-6 Secrets | Input masked, never show, only replace | partly (`AuthLink`) | "Ersetzen" in the detail (tab Auth) and env secrets for stdio missing; secret field in the form missing |
| P0-7 Tool filter | Tool on/off, effective immediately | yes (`Detail`) | marking of new/vanished tools missing |
| P0-8 REST tools | Editor (name, method, URL template, header/query/body, JSON schema, secret reference, timeout, size limit) | no draft | only type tile and row "local · 3 REST-Tools" |
| P0-9 SSRF | Admin setting for internal targets; comprehensible error message | partly (`AdminInstanz`) | switch instead of list; message "Ziel nicht erlaubt (SSRF-Schutz)" missing |
| P0-12 Auth link token | Page with input, masking, saving, test, "back to the tool" | partly (`AuthLink`) | error, expired, 403, header variant |
| P0-12 Auth link OAuth | Start server-side, callback shows "connected" | no draft | return page success/error |
| P0-12 stdio draft | "waiting for approval", confirmation in the web UI | yes (`StdioFreigabe`) | state in the list missing |
| P0-12 Audit | Management actions visible | yes (`Audit`) | empty, paging |
| P0-13 Upstream OAuth | Sign-in kind OAuth, scopes visible, `auth_expired` with new link, "not supported" | partly (`UpstreamNeu`, `Detail`) | scopes, button "Neu verbinden", message "nicht unterstützt" |
| P0-14 Status | 5 statuses with timestamp, percentiles, last error message | partly (`Main`, `Detail`, `Dashboard`) | detail shows only p50/p95/p99; `unknown` and "waiting for …" missing |
| P0-14 Extras | Breaker time, hiding the tools of open upstreams (configurable), idempotent approval per tool | partly | countdown "00:42" yes; switches "Tools ausblenden" and "idempotent" no draft |
| P0-15 Statistics page | per upstream and per tool: percentiles, error rate, history; windows 5 min/1 h/24 h/7 d | partly (`Statistik`) | per tool missing; average/max duration missing; history only calls/h |
| P0-15 Admin | aggregated instance figures without contents | no draft | |
| P0-15 Context size | `tools/list` size in tokens per client | yes (`Dashboard`) | |
| Admin settings | stdio global, SSRF relaxation, registration | yes (`AdminInstanz`) | retention (14 days/13 months, "configurable"), limit defaults, `stdio_idle_min`, `stdio_max_procs` missing |
| Audit log | Management actions, status changes to `open`/`auth_expired` | yes (`Audit`) | filter "Anmeldung" has no data source (section 3) |
| P1 Meta-tool mode | Direct or meta tools per user | yes (`Clients`) | phase 3 |
| P1 Import | Import `mcpServers` JSON, export without secrets, template list | partly | buttons yes, dialog, export and template list no draft |
| P1 Call log | Time, client, tool, duration, status | no draft | `Audit` is not the call log |
| P1 Poisoning check | Manually approve blocked tools | no draft | phase 4 |
| Empty/error/loading states | for all lists and cards | no draft | throughout |

## 3. Coverage UI → spec (surplus and contradictions)

Every item names file and location. "UI-only" = neither spec nor plan asks for it.

| # | File / location | Finding | Kind |
|---|---|---|---|
| 1 | `Dashboard`, KPI "Aufrufe pro Minute", note "Limit 60 / min pro Client" | Spec: 60/min applies per **upstream** (P0-5); per user and per token there are own limits (plan 1: `calls_per_min` 120 per user). A limit "per client" exists only as a call budget in phase 3 | Contradiction |
| 2 | `Dashboard`, column status "Online/Inaktiv", subtitle "verbunden seit 2 h 14 min", "Sitzung offen" | The gateway is stateless (P0-1), there is no connection or session. Measurable are only the last call (token/client `last_used`) and open `subscriptions/listen` streams | Contradiction |
| 3 | `Dashboard`/`Clients`, subtitle "MacBook Pro", "Arbeits-PC", "agent.example.org" | Neither DCR nor a PAT delivers device names. Available are client name, redirect host, times | UI-only, not deliverable |
| 4 | `Dashboard`, column "Aktion: Widerrufen" and column "Anmeldung: Token" (nas-cron) | The dashboard mixes OAuth clients and PATs; `Clients` shows only OAuth, `Tokens` only PATs. Revoking a PAT from here requires a different API | Consistency |
| 5 | `Dashboard`/`Main`/`Detail`, message "p95 über 3× der 7-Tage-Basislinie", detail warning box "Status wechselt auf healthy, sobald …" | Spec P0-15 defines `degraded` that way, but only in phase 2. Plan 1 defines `degraded` as 1–4 consecutive errors. The text must not be hard-coded in the UI | Temporal contradiction |
| 6 | `Main`, filter "Tags ⌄" | Tags do not occur in spec and plans | UI-only |
| 7 | `Main`, button "Alle testen" | not in spec; creates load on all upstreams (rate limit, breaker count too) | UI-only |
| 8 | `Main`, "Letzte 7 Tage ⌄" and "Auto-Refresh ⌄" | Effect of the window on the list (p95, bars) not defined; auto-refresh not in spec (pure polling, uncritical) | unclear |
| 9 | `Main`, navigation badge "3" | Meaning not defined (assumption: upstreams with `degraded`, `open`, `auth_expired`) | unclear |
| 10 | `Main`, column "Letzte 24 Aufrufe" and `Detail`, "Status, letzte 24 Stunden" | The same 24 bars with two meanings (last 24 calls / 24 hours). No plan delivers the data for it | unclear |
| 11 | `Main`, status chip "Deaktiviert" with message "Vom Nutzer deaktiviert" | fits `disabled`; status `unknown` (plan 1) and state "waiting for auth/approval" (spec P0-12) missing | Gap |
| 12 | `Detail`, "Verfügbar 91,7 %" and heatmap 7 days × 24 h | Availability and status history are not in the spec; plan 1 stores the status only on change | UI-only, needs new data |
| 13 | `Detail`, column "Art" (read-only/writing/deleting) | Spec knows "sensitive" only in phase 3 and `readOnlyHint`/`idempotentHint` from upstream annotations. Derivable but not required | UI-only, derivable |
| 14 | `Detail`, tool columns "Fehler" and "p95" per tool | Spec P0-15 requires percentiles per tool, plan 1 delivers them only in phase 2 | Phase 2 |
| 15 | `Detail`, tabs "Auth" and "Aufrufe" | "Aufrufe" would be the optional call log (P1, parameters not stored); "Auth" needed for replacing secrets and OAuth scopes | unfinished |
| 16 | `UpstreamNeu`, field "Name" with hint "Kurzname für Tool-Präfixe" | Spec separates nothing, plan 1 has `name` and `slug` (regex `^[a-z0-9][a-z0-9-]{0,31}$`, 32 characters). The draft shows neither rule nor length | Gap |
| 17 | `UpstreamNeu`, sign-in "OAuth" preselected | Upstream OAuth is phase 2 (P0-13); phase 1 knows none/bearer/header/env. The default should be "Keine" | Phase |
| 18 | `UpstreamNeu`, "Timeout pro Aufruf (s) = 60" | Spec: connect 10 s, `tools/list` 15 s, `tools/call` 60 s, overridable per upstream. The draft offers only the call timeout (detail shows all three) | Subset |
| 19 | `UpstreamNeu`, link "mcpServers-JSON importieren" and `Main` "JSON importieren" | P1 (phase 3) | Phase 3 |
| 20 | `StdioFreigabe`, "Arbeitsordner /data/stdio/christian" | Spec: `DATA_DIR/stdio/<uid>`; plan 1: no user ID in the path, UID from the supervisor | Contradiction |
| 21 | `StdioFreigabe`, button "Freigeben und starten" | The process starts lazily on the first call (spec P0-5); the checklist says so itself ("beim ersten Aufruf") | Term |
| 22 | `AuthLink`, input field with prefilled example token, button "Anzeigen" | Showing the value just typed is uncritical; stored secrets must never be shown (P0-6). The example value must never be shipped | Note |
| 23 | `AuthLink`, "gilt nur einmal" + button "Testen" before "Speichern" | Unclear whether the test consumes the link (spec: single use, 15 min) | Gap |
| 24 | `Consent`, scope `mcp` and `mcpwarden:admin`; `Clients`, column "Berechtigung" | Spec/plan 0b: `mcp:tools`, besides `openid`, `offline_access`. `mcpwarden:admin` is granted only in phase 2 | Contradiction |
| 25 | `Consent`, permissions without selection | Spec: admin scope "separately displayable". Whether the user can deselect it is open | open |
| 26 | `Consent`, only the redirect fully visible | Plan 0b requires the redirect host always prominent and an extra warning for `localhost` | Gap |
| 27 | `Statistik`, Y axis (columns) | Grid line "500" lies on the value ≈ 615 (column height = value/1000·130 px, line at y=70) | Error in the draft |
| 28 | `Statistik`, call statuses in raw notation (`tool_error`, `breaker_open`, …) | matches the spec, but the rest of the UI is German; `Detail` uses German names for the same statuses | Term |
| 29 | `Statistik`, only filter "Alle Upstreams" | Spec: also per tool | Gap |
| 30 | `Audit`, tab "Anmeldung" | Plan 1 writes no login events to `audit_log`; Better Auth stores sessions, not events | UI-only |
| 31 | `Audit`, column "Ergebnis" (4 values) | `audit_log` (plan 1) has no result field, only `meta`; "Abgelehnt" for `invoke_tool` belongs to phase 3 (routing) | Gap |
| 32 | `Audit`, visibility | Spec does not say whether users see only their own and admins foreign entries | open |
| 33 | `Admin`, invitation link `…/invite/7Hk2…xQ9a`, "7 Tage gültig" | Spec: link, single use, expiring (duration not fixed). Plan 1: invitation = email allowlist without token, link is `<BASE_URL>/register` | Contradiction spec/plan/UI |
| 34 | `Admin`, no "Löschen", no "Entsperren" | Spec P0-4 requires deleting; plan 1.1.10 ban, unban, delete | Gap |
| 35 | `AdminInstanz`, switch "SSRF-Schutz für interne Ziele lockern" | Plan 1: list `ssrf.allow` (CIDR or hostname), no boolean. A global switch also opens metadata IPs | Contradiction |
| 36 | `AdminInstanz`, switch "Registrierung per Allowlist" | Spec: "invitation or allowlist"; plan 1 merges both in `user_invite`. The draft has no place to maintain the allowlist | Contradiction |
| 37 | `AdminClients`, patterns `https://claude.ai/api/mcp/auth_callback`, `cursor://anysphere.cursor-retrieval/*`, `zed://*` | Plan 0b: Claude web callback "unverified"; spec names `cursor://`, `vscode://`. The concrete patterns are unverified | unverified |
| 38 | `Settings`, "E-Mail ändern, per Link bestätigen", "E-Mail-Benachrichtigungen" (3 switches) | There is no mail sending (plan 1: invitation without mail sending; no SMTP ENV in P0-10). Notification is only "optional (P1)" in the spec; "Neuer Client verbunden" and "Wöchentliche Zusammenfassung" are missing entirely | UI-only |
| 39 | `Settings`, "Mindestens 12 Zeichen" | Spec and plan 0a set no minimum length | Gap |
| 40 | `Settings`, "Konto löschen" | Spec: admin deletes user. Plan 1.1.10 forbids deleting the own account via the admin API; the last admin is protected | Contradiction |
| 41 | `Settings`, "Web-Sitzungen" | Better Auth function (session list, sign out); not used in spec and plan 0a | UI-only, plausible |
| 42 | `Settings`, color scheme "Dunkel" | all boards are drawn light only; there are no dark values | UI-only, values missing |
| 43 | all boards, `<link>` to Google Fonts | The gateway is self-hosted; an external font fetch transmits IP addresses. Serve fonts locally | Note |
| 44 | all boards, role | Only the admin "Christian" is drawn. The navigation for users without the admin role (admin group, audit view) is missing | Gap |

Consistent with the spec: default values 60/min and 5 parallel (`UpstreamNeu`, `Detail`); timeouts 10/15/60 s (`Detail`); time windows 5 min, 1 h, 24 h, 7 d (`Statistik`); percentiles p5/p50/p75/p95/p99 (`Statistik`); call status names (`Statistik`); "Overhead p95 ≤ 50 ms" (`Dashboard`, `Detail`); expiry of never-used registrations after 30 days (`AdminClients`); cap of 50 upstreams (`Admin`); link lifetime 15 min (`AuthLink`: 14 minutes remaining); "admin sees only metadata" (`Admin*`); tool prefix `sentry__list_issues` (`UpstreamNeu`); meta tools `find_tools`, `describe_tool`, `invoke_tool` (`Clients`); "worth it from about 50 tools" (`Clients`); note "SSRF protection does not apply to stdio" (`StdioFreigabe`).

## 4. Contradictions and terminology deviations with recommendation

| # | Topic | Spec / plan | UI | Recommendation |
|---|---|---|---|---|
| W1 | Status names | Spec: `healthy`, `degraded`, `open`, `auth_expired`, `disabled`. Plan 1 adds `unknown`. Spec P0-12 also names "waiting for token/OAuth/approval" as a status of `get_upstream_status` | "Healthy", "Degraded", "Breaker offen", "Auth abgelaufen", "Deaktiviert"; no `unknown`, no "waiting for …" | **Adjust the spec:** add `unknown` and keep a second value `setup` (`ready`, `awaiting_auth`, `awaiting_approval`) next to the health status; this keeps the health enum small and `get_upstream_status` has both. **Adjust the UI:** API values stay English, display via a label table; proposal in German: "In Ordnung", "Eingeschränkt", "Breaker offen", "Auth abgelaufen", "Deaktiviert", "Unbekannt". Reason: one source for texts, no anglicism mix |
| W2 | Scope names | `mcp:tools`, `openid`, `offline_access`; `mcpwarden:admin` reserved (phase 2) | `mcp`, `mcpwarden:admin` | **Adjust the UI** (display title per scope, raw name small in monospace). `openid`/`offline_access` not as their own rows but as the hint "bleibt angemeldet". Admin row only from phase 2 |
| W3 | Percentiles | P0-14 requires p5/p50/p75/p95/p99 in the status | `Detail`: p50/p95/p99, `Main`: p95; `Statistik`: all five | **Adjust the UI:** the detail gets the table with all five values (the chart may show three lines). Reason: otherwise the spec value "in the status" is missing |
| W4 | Limits | 60/min and 5 parallel per upstream; user limit 120/min (plan 1); token limit own counter | "Limit 60 / min pro Client" | **Adjust the UI:** the card says "Limit je Upstream 60/min"; user and token limits appear only once hits exist |
| W5 | stdio values | Idle 10 min, 5 child processes (spec question 6, decided); plan 1: `stdio_idle_min`, `stdio_max_procs` per user | visible nowhere | **Extend the UI:** the admin tab Nutzer gets per user "Limits" (dialog) with upstreams, calls/min, connections, stdio processes, stdio idle; default values from the API, not in code |
| W6 | Slug | `^[a-z0-9][a-z0-9-]{0,31}$`, 32 characters, unique per user, `__` separates | "Name" without a rule | **Adjust the UI:** separate field "Kurzname" with live preview "sentry__tool", counter x/32, error message on collision (409). Reason: the slug is part of the tool names and cannot be changed without consequences for clients |
| W7 | Session / "online" | stateless, no session | "Online", "verbunden seit", "Sitzung offen" | **Adjust the UI:** "Aktiv" = call within the last 5 min, otherwise "Inaktiv"; the column "seit" becomes "Zuletzt aktiv". A "connected since" exists only if a list subscription is open, and that is too incidental for a display |
| W8 | Invitation model | Spec: link, single use, expiring. Plan 1 (O5): email allowlist, link = `/register` | Token link `/invite/…`, 7 days, plus switch "Registrierung per Allowlist" | **Decision needed (question 2).** Recommendation: **adjust plan 1** to a token link with optional email binding (spec is confirmed), `/invite/[token]` as the accept page, drop the switch "per Allowlist" or keep it as a domain/email list in `AdminInstanz`. Reason: without mail sending a token link is the only way that works without prior knowledge of the address |
| W9 | SSRF relaxation | List CIDR/hostnames (`ssrf.allow`) | a boolean | **Adjust the UI:** table with "+ Eintrag", hint about metadata IPs. Reason: a switch also opens 169.254.169.254 |
| W10 | `degraded` | Spec: slow or partially failing (p95 > 3× baseline from phase 2); plan 1: 1–4 consecutive errors | Text hard-coded on baseline | **Adjust the UI:** the backend delivers `statusReason` (text); the UI only displays it |
| W11 | Status colors | – | Healthy green, Degraded yellow, Breaker red, Auth blue, Deaktiviert gray; status dot plus text | fits the note "color never alone". The `Detail` heatmap carries only colors with `title` text: **extend the UI** (pattern or table alternative) |
| W12 | Password length | not regulated | 12 characters | **Adjust the spec** (P0-4: minimum length 12, enforced server-side; the option in Better Auth is **unverified**). The UI shows only what the server checks |
| W13 | PAT format | Plan 0b: `mcpw_pat_` + 32 bytes base64url (43 characters); "prefix = first 8 characters" (would be `mcpw_pat`) | 32 hex characters, "Beginnt mit mcpw_pat_9f3c…" | **Adjust plan 0b:** display prefix = `mcpw_pat_` + 4 characters. The draft text is only an example |
| W14 | stdio path | `DATA_DIR/stdio/<uid>`; plan 1: no user ID in the path | `/data/stdio/christian` | **Adjust the UI:** have the server deliver the path, do not build it in the UI |
| W15 | Settings scope | Spec: nothing on profile, mail, self-deletion; plan 1.1.10 forbids self-deletion | Email change, 3 mail notifications, delete account, dark mode | **Adjust the UI:** phase 1 gets name, password, web sessions, appearance (System/Hell; Dunkel only once values exist). Drop mail features and self-deletion until the decision (question 3) |
| W16 | Page assignment | 0a: `/`, `/login`, `/register`; 0b: `/consent`, `/settings/tokens`, `/settings/connections`, `/admin/oauth`; phase 1: `/upstreams`, `/upstreams/new`, `/upstreams/[id]`, `/admin/users`, `/admin/settings` | Navigation Dashboard, Upstreams, Statistik, Clients, Tokens, Audit, Admin (tabs Nutzer/Clients/Instanz), Einstellungen | **Assignment in the frontend plan** (section route map): plan paths stay, navigation texts follow the draft. The backend plans also describe Vue pages; the frontend takes them over (question 1) |
| W17 | Term "Verbindungen" vs "Clients" | Plan 0b: "Verbindungen", `/api/me/connections` | "Clients" | **UI word "Clients"** (the spec uses it), API path stays |
| W18 | "Aufruf" vs "Call", "Breaker" | Spec: "Circuit Breaker", "Aufrufe" | "Breaker offen" | keep, glossary in the frontend plan |
| W19 | Remaining time of auth link | 15 min | "14 Minuten" | no contradiction (remaining time); compute the display from `expiresAt` |
| W20 | Statistics figures | `percentile_cont`, rollup deviation ≤ 5 % | exact values | The UI windows (up to 7 d) lie within the 14 days of raw data, so exact values. Only if longer windows later come from rollups, show the hint "ungefähr" (approximately) |

## 5. Data needs per screen

All paths except `/api/auth/*` are proposals of the frontend plan, as far as the backend plan does not name them. Types will live in `shared/api-types.ts`. "Plan" says whether the backend plan provides the route including the required fields (yes / partly / no).

| Screen | Method path | Response (rough) | Phase | Plan |
|---|---|---|---|---|
| All (shell) | GET `/api/auth/get-session` | `{ user:{ id, name, email, role, banned }, session }` | 0a | yes (Better Auth) |
| Login / registration | POST `/api/auth/sign-in/email`, `/sign-up/email`, `/sign-out` | Better Auth responses, error 403 "registration closed" | 0a | yes |
| Registration via invitation | GET `/api/invites/:token` (proposal), POST `/api/auth/sign-up/email` with token | `{ valid, email? , expiresAt }` | 1 | no (plan has an email allowlist) |
| Consent | GET `/api/oauth/consent-info?…` | `{ client:{ name, redirectUris[], allowlisted, registeredAt, viaDcr }, scopes[], resource, loopback }`; consent via Better Auth client `oauth2.consent` | 0b | partly (route yes, fields open) |
| Settings | POST `/api/auth/update-user`, `/change-password`, GET `/list-sessions`, POST `/revoke-session` | Better Auth responses (names **unverified**) | 0a/0b | no (not used in the plan) |
| Tokens | GET/POST `/api/me/pats`, DELETE `/api/me/pats/:id` | List `{ id, name, prefix, createdAt, lastUsedAt, revokedAt }`; POST additionally returns `token` once | 0b | yes |
| Clients | GET `/api/me/connections`, DELETE `/api/me/connections/:clientId` | `{ clientId, name, scopes[], grantedAt, lastUsedAt, redirectHost }` | 0b | partly (device not deliverable) |
| Clients (tool mode) | GET/PUT `/api/me/preferences` | `{ toolMode:'direct'|'meta' }` | 3 | no |
| Admin clients (DCR) | GET/PUT `/api/admin/oauth/policy`; GET/POST/DELETE `/api/admin/oauth/allowlist`; GET `/api/admin/oauth/clients`; DELETE `/api/admin/oauth/clients/:id` | `{ mode }`, allowlist `{ id, label, namePattern, redirectPatterns[], builtin }`, clients `{ id, name, redirectUris[], createdAt, lastUsedAt, userCount, allowlisted, expiresInDays? }` | 0b | yes |
| Upstreams (list) | GET `/api/upstreams` | per entry `{ id, slug, name, type, url|command, enabled, status, statusReason, statusChangedAt, lastError, toolsEnabled, toolsTotal, nextRetryAt?, p95Ms?, recent?:[ok|warn|err|none ×24], setup }` | 1 (base), 2 (`p95Ms`, `recent`) | partly (base yes, aggregates no) |
| Create/change upstream | POST `/api/upstreams`, GET/PATCH/DELETE `/api/upstreams/:id` | Input `{ name, slug, type, url, transport, authType, authHeaderName, rate_per_min, max_concurrent, timeouts, command, args, env, cwd }`; response without secret, with `hasSecret` | 1 | yes |
| Replace secret | PUT `/api/upstreams/:id/secret` | Input `{ kind, name?, value }`, response `{ hasSecret:true }` | 1 | yes |
| Test connection | POST `/api/upstreams/:id/test` | `{ ok, tools[{name,description}], latencyMs }` or `{ ok:false, errorCode, message }` | 1 | yes |
| Tools | GET `/api/upstreams/:id/tools`, PUT `/api/upstreams/:id/tools/:name` | `{ name, description, enabled, gone, firstSeenAt, annotations?{ readOnlyHint, destructiveHint, idempotentHint } }`; errors and p95 per tool only in phase 2 | 1 (2) | partly (annotations not named) |
| stdio capability | GET `/api/me/capabilities` | `{ stdio:{ allowed, reason? }, limits:{ maxUpstreams, used } }` | 1 | no (plan names the messages, not the route) |
| stdio approval | POST `/api/upstreams/:id/approve`, DELETE `/api/upstreams/:id` (discard) | `{ status }`; draft carries `createdVia:{ client, at }` | 2 | no |
| Dashboard | GET `/api/dashboard?window=` | `{ kpis:{ clientsActive, clientsTotal, callsPerMin, successRate, overheadP95Ms }, clients[{ kind:'oauth'|'pat', id, name, allowlisted, lastActiveAt, callsPerMin, contextTokens }], attention[{ upstreamId, name, status, message, nextRetryAt? }], series:[{ t, calls }] }` | 2 (clients part possible from 1) | no |
| Statistics | GET `/api/stats/summary?window&upstream&tool`; `/api/stats/timeseries`; `/api/stats/upstreams` | Key figures, hourly series, result per status, rows `{ upstream, calls, okRate, p5, p50, p75, p95, p99, overheadP95 }` | 2 | no (the phase 1 plan moves the page to 2) |
| Upstream detail (stats) | GET `/api/upstreams/:id/stats?window` | KPIs, percentile series, errors by kind `{ kind, count, avgMs }`, tool rows | 2 | no |
| Upstream detail (history) | GET `/api/upstreams/:id/health-history?hours=` | `[{ t, state:ok|warn|err|none }]`, `availability` | 2 | no (the data model stores only changes) |
| Audit | GET `/api/audit?category&cursor&limit` | `{ items:[{ ts, actor, clientName, action, targetType, targetLabel, result }], nextCursor }` | 1 (writing), reading open | no (write path yes, read route no) |
| Auth link token | GET `/api/links/:token`; POST `/api/links/:token/test`; POST `/api/links/:token/submit` | `{ kind:'token'|'header'|'oauth', upstream:{ slug, url }, headerName?, expiresAt, state }`; test `{ ok, toolCount }`; errors 403/410 | 2 | no |
| Auth link OAuth | GET `/api/links/:token/oauth/start` (redirect), return page `/link/done?status=` | Status `connected` / `unsupported` / `error` | 2 | no |
| Admin users | GET `/api/admin/users`; POST `/api/admin/users/:id/ban|unban`; DELETE `/api/admin/users/:id`; PUT `/api/admin/users/:id/limits` | `{ id, email, name, role, banned, createdAt, upstreamCount, lastActivityAt, stdioAllowed, limits }` | 1 | partly (`lastActivityAt`, `stdioAllowed` missing in the description of the list) |
| Admin invitations | GET/POST/DELETE `/api/admin/invites` | `{ id, createdAt, expiresAt, usedAt, email?, link? }` (link only on creation) | 1 | partly (email model) |
| Admin instance | GET/PUT `/api/admin/settings` | `{ 'stdio.enabled', 'ssrf.allow':string[], … }` | 1 | yes (switch registration open) |
| Admin statistics | GET `/api/admin/stats` | aggregated counters without contents | 2 | no |
| Import | POST `/api/upstreams/import`, GET `/api/upstreams/export` | Preview and result without secrets | 3 | no |

Note on data retrieval: polling instead of push (auto-refresh 15 s / 30 s / 1 min / off); `ETag` or `Cache-Control: no-store` for lists with status values remains a backend decision.

## 6. Open questions

All eight questions are **decided 2026-11-04** (the user confirmed the respective recommendation). No question is open any more. Implementation in `docs/plans/frontend.md`; the backend plans and the spec are to be adjusted to the decisions (state of this document: not checked).

1. **Responsibility for Vue files** (decided 2026-11-04). The frontend takes over all `app/**` files (pages, layouts, components); the backend phases deliver API, tests and contract contributions. Affects 0a task 9, 0b tasks 3 to 5, phase 1 tasks 1.1.8 to 1.1.10 and 1.3.5, which hand over their Vue pages. Login (`/login`) and registration/invitation (`/register`, `/invite/<token>`) are thus frontend tasks.
2. **Invitation model** (W8; decided 2026-11-04). Token link `/invite/<token>`, valid 7 days, optionally bound to an email. Plan 1 (email allowlist without token) is to be adjusted; the switch "Registrierung per Allowlist" is dropped.
3. **Account functions in the settings** (decided 2026-11-04). Email change, notification mails and account self-deletion are dropped and removed from the plan and the draft implementation (no mail sending, the contradiction with plan 1.1.10 is thereby moot).
4. **Dashboard timing** (decided 2026-11-04). Dashboard (clients table, attention card) and audit reading run already after phase 1; phase 1 delivers two additional routes for it: `/api/dashboard` without KPIs and `/api/audit`. KPIs and chart follow with phase 2.
5. **Consent and admin scope** (decided 2026-11-04). Consent with two switches: `mcp:tools` always on, `mcpwarden:admin` deselectable. The admin scope switch stays hidden until phase 2. Whether the Better Auth consent accepts a scope subset is unverified.
6. **Audit visibility** (decided 2026-11-04). Users see their own entries, admins additionally instance events (e.g. user banned, setting changed).
7. **UI-only elements** (decided 2026-11-04). Tags and device names are dropped. "Alle testen" comes later with confirmation and rate hint. Availability and heatmap are built only if phase 2 delivers `health-history`.
8. **Dark mode** (decided 2026-11-04). After phase 2; the choice "System" (and "Dunkel") stays hidden until then.
