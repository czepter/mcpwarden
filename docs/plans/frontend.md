# Frontend: Umsetzungsplan

Stand: 2026-11-04 · Grundlage: `docs/spec.md` v0.4, UI-Entwürfe (Claude-Artefakt `EXj4fJ9FsvkUjZ3o5hVEcM`, 16 Boards), Abgleich in `docs/ui-abgleich.md` (Befunde W1 bis W20, Fragen 1 bis 8), Backend-Pläne `phase-0a.md`, `phase-0b.md`, `phase-1.md`. Phase 2 und 3 haben noch keinen Plan; ihre Routen sind hier als Vorschlag geführt.

Kennzeichnung: **Annahme** = ohne Rückfrage übernommen, im Abgleich begründet. **unverifiziert** = nicht gegen offizielle Quellen bestätigt. **entschieden 2026-11-04** = vom Nutzer bestätigt (Fragen 1 bis 8 des Abgleichs, jeweils die dort genannte Empfehlung). Die Backend-Pläne `phase-0a.md`, `phase-0b.md`, `phase-1.md` sind an diese Entscheidungen anzupassen (Vue-Seiten entfallen dort, Einladungsmodell, Routen `/api/dashboard` und `/api/audit` in Phase 1); bis dahin gilt dieser Plan und nennt die Abweichung als Erwartung (Abschnitt 3, Risiken R2, R16, R17).

Entscheidungen im Überblick (Nummern = Fragen im Abgleich, Abschnitt 6):

| # | Entscheidung (entschieden 2026-11-04) | Wirkung in diesem Plan |
|---|---|---|
| 1 | Das Frontend übernimmt alle `app/**`-Dateien (Seiten, Layouts, Komponenten); die Backend-Phasen liefern API, Tests und Vertragsbeiträge | Abschnitt 4, A3, Aufgaben 7 bis 11 |
| 2 | Einladung als Token-Link `/invite/<token>`, 7 Tage gültig, optional an eine E-Mail gebunden | Routenkarte, Abschnitt 9, Aufgaben 7 und 11 |
| 3 | E-Mail-Änderung, Benachrichtigungsmails und Konto-Selbstlöschung entfallen (aus Plan und Entwurfs-Umsetzung gestrichen) | Aufgabe 8, Abschnitt 9 |
| 4 | Dashboard (Clients, Aufmerksamkeit) und Audit-Lesen laufen schon nach Phase 1 (Routen `/api/dashboard` ohne KPIs, `/api/audit`) | Routenkarte, Abschnitt 15, Aufgabe 13 |
| 5 | Consent mit zwei Schaltern (`mcp:tools` immer, `mcpwarden:admin` abwählbar); der Admin-Scope-Schalter bleibt bis Phase 2 ausgeblendet | Aufgabe 7, Abschnitt 11 |
| 6 | Audit: Nutzer sehen eigene Einträge, Admins zusätzlich Instanzereignisse | Abschnitt 11, Aufgabe 13 |
| 7 | Tags und Gerätenamen gestrichen; „Alle testen“ später mit Bestätigung und Rate-Hinweis; Verfügbarkeit und Heatmap nur mit `health-history` aus Phase 2 | Aufgaben 10, 14, 16 |
| 8 | Dunkelmodus nach Phase 2; die Auswahl „System“ bleibt bis dahin ausgeblendet | Abschnitt 2, A8, Aufgabe 8 |

## 1. Ziel und Abnahmekriterien

Ziel: Die Web-Oberfläche von mcpwarden (Nuxt 4, shadcn-vue, Better Auth) so bauen, dass ein einzelner Agent sie **ohne Änderungen an `server/`** umsetzen kann, vor den Backend-Phasen gegen einen Mock läuft und Phase für Phase auf echte Routen umgestellt wird.

Abnahme (je Punkt prüfbar):

- [ ] F1 Alle 16 Entwurfs-Boards sind als Seiten oder Zustände umgesetzt (Routenkarte, Abschnitt 5), inklusive der im Abgleich ergänzten Leer-, Lade- und Fehlerzustände.
- [ ] F2 `pnpm ui:dev` startet die komplette Oberfläche mit Mock-Daten ohne laufendes Backend (Abschnitt 13); `pnpm dev` läuft gegen die echten Routen. Je Mock-Domäne ist die Umstellung eine Konfigurationszeile.
- [ ] F3 Der Vertrag `shared/api-types.ts` deckt jede im Frontend benutzte Route; Mock-Antworten und (sobald vorhanden) echte Antworten bestehen denselben Contract-Test.
- [ ] F4 Secrets (Upstream-Tokens, PATs, Einladungslinks, Env-Werte) erscheinen nach dem Speichern nirgends mehr: nicht im DOM, nicht in Netzwerkantworten, nicht im Browser-Speicher (Canary-Test, Abschnitt 10).
- [ ] F5 Rollenabhängige Sichtbarkeit (Admin / Nutzer) wirkt in Navigation und Seitenschutz; jede Aktion bleibt zusätzlich serverseitig geprüft (Abschnitt 11).
- [ ] F6 Jede Seite besteht axe-core ohne Verstöße der Stufen „serious“ und „critical“; Tastaturbedienung und Fokusführung sind je Seite geprüft (Abschnitt 12).
- [ ] F7 Status werden nie allein über Farbe vermittelt (Punkt und Text), Zielgrößen für Bedienelemente mindestens 44 px wie im Entwurf.
- [ ] F8 Seitenleiste ein- und ausklappbar (248 px / 64 px), Zustand bleibt nach Neuladen erhalten; unter 700 px nutzbar.
- [ ] F9 Nach 0a laufen Login, Registrierung und Sitzung gegen echte Daten; nach 0b Consent, Tokens, Clients, Admin Clients (DCR); nach Phase 1 Upstreams, Tool-Filter, Admin Nutzer/Einladungen/Instanz, Einladung annehmen (`/invite/<token>`), Dashboard (Clients, Aufmerksamkeit), Audit lesen, stdio-Hinweise (Abschnitt 15).
- [ ] F12 Gestrichene Elemente sind nirgends gebaut oder erreichbar: Tags, Gerätenamen, E-Mail-Änderung, Benachrichtigungsmails, Konto-Selbstlöschung, „Alle testen“ (bis später), Farbschema-Auswahl „System“/„Dunkel“ (bis nach Phase 2). Test: E2E sucht diese Texte und Routen und findet keine.
- [ ] F13 Login, Registrierung und Einladung annehmen sind Frontend-Seiten (`/login`, `/register`, `/invite/<token>`); die Backend-Phasen liefern nur API und Tests. Einladung: Token gilt 7 Tage, ist optional an eine E-Mail gebunden, ungültige oder abgelaufene Token zeigen eine verständliche Fehlerseite.
- [ ] F14 Consent zeigt zwei Schalter: `mcp:tools` (immer an, nicht abwählbar) und `mcpwarden:admin` (abwählbar, ab Phase 2 sichtbar); das Ergebnis der Auswahl geht an den Server, der nur die gewählten Scopes vergibt.
- [ ] F10 Zeit- und Zahlenformate deutsch (`Intl`, Zeitzone des Browsers), relative Zeiten („vor 8 s“) aktualisieren sich.
- [ ] F11 Kein `any` an der API-Grenze; `nuxi typecheck` und ESLint grün; `pnpm ui:test` grün.

Nicht Ziel dieses Plans: Backend-Routen, Datenbank, MCP-Endpoint, Supervisor, E-Mail-Versand (entfällt, Entscheidung 3), Dunkelmodus-Werte (kommen nach Phase 2, Entscheidung 8).

## 2. Geprüfte Versionen und Annahmen

Geprüft am 2026-11-04. „npm“ = `npm view <paket> version`. „Doku“ = offizielle Dokumentation per Abruf (shadcn-vue.com, nuxt.com, mswjs.io). Das Stack-Vorbild ist shadcn-vue, **nicht** Nuxt UI (`@nuxt/ui` wird nicht eingesetzt).

| Paket | Version | Quelle | Verwendung / Anmerkung |
|---|---|---|---|
| `nuxt` | 4.6.4 | npm, Plan 0a | Standardverzeichnis `app/` laut Doku bestätigt; `ssr`, `routeRules`, `runtimeConfig.public` existieren (Doku) |
| `shadcn-vue` (CLI) / `shadcn-nuxt` | 2.9.0 / 2.9.0 | npm | Installation laut Doku: `tailwindcss`, `@tailwindcss/vite`, Modul `shadcn-nuxt` mit `shadcn: { prefix: '', componentDir: '@/components/ui' }`, `pnpm dlx shadcn-vue@latest init`, `add <name>` |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.4 | npm, Plan 0a | CSS `@import "tailwindcss";`, Vite-Plugin in `nuxt.config.ts` (Doku) |
| `reka-ui` | 2.11.0 | npm | kommt über shadcn-vue; Version nicht gesondert gegen die Doku geprüft (unverifiziert) |
| `@vueuse/core` | 15.0.0 | npm | Doku verlangt es für das optionale Plugin `ssr-width`; im Plan zusätzlich für `useIntervalFn`, `useDocumentVisibility`, `useClipboard` (API aus dem Gedächtnis, **unverifiziert**) |
| `vee-validate`, `@vee-validate/zod` | 4.15.1 / 4.15.1 | npm; Doku (Form-Seite) | Doku zeigt `toTypedSchema(z.object(...))` und `useForm({ validationSchema })`. Die Form-Komponente ist „nicht mehr in aktiver Entwicklung“, empfohlen wird `Field` (Doku). Plan: **`Field`-Familie + vee-validate** |
| `zod` | 4.6.7 | npm | Plan 1 pinnt `zod@^4.2`. Kompatibilität von `@vee-validate/zod` 4.15.1 mit zod 4 ist **unverifiziert** (Spike in Aufgabe 2); die Field-Doku nennt „Standard Schema“-Fehlerlisten als alternativen Weg |
| `vue-sonner` | 2.0.9 | npm; Doku | `shadcn-vue add sonner`; `<Toaster />` im Root-Layout, `toast()` aus `vue-sonner`, Stylesheet `vue-sonner/style.css` (Doku) |
| `@unovis/vue` | 1.7.1 | npm; Doku | `shadcn-vue add chart` baut auf Unovis; Komponenten `ChartContainer`, `ChartTooltip(Content)`, `ChartCrosshair`, `ChartLegendContent`; Farben über `chartConfig` und `--chart-n` (Doku). `accessibilityLayer` kommt in der Doku nicht vor |
| `@tanstack/vue-table` | 9.3.1 | npm; Doku (Data-Table: v9) | **nicht eingesetzt**: Listen sind klein (≤ 50 Upstreams), einfache `Table` genügt |
| `@nuxtjs/color-mode` | 4.1.0 | npm; Doku | `colorMode: { classSuffix: '' }`, `useColorMode()`; zunächst nur Hell fest, die Auswahl „System“ ist ausgeblendet; Auswahl System/Hell/Dunkel erst nach Phase 2 (entschieden 2026-11-04) |
| `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | 5.3.0 / 5.3.0 | npm | Schriften lokal statt Google Fonts (Abgleich Punkt 43); Import-Pfade **unverifiziert** |
| `lucide-vue-next` 1.0.0 / `@lucide/vue` 1.68.0 | npm | beide existieren; welches Paket `shadcn-vue init` 2.9.0 einträgt, ist **unverifiziert** (`iconLibrary` in `components.json` entscheidet) |
| `msw` | 3.0.3 | npm; Doku (Migration 2 → 3, Quickstart) | Node ≥ 22; `http` und `HttpResponse` aus `msw/http`; `setupWorker` aus `msw/browser`; `setupServer` aus `msw/node`; `onUnhandledFrame` statt `onUnhandledRequest`; optionales Vite-Plugin `msw/vite` liefert den Worker (Doku Migration). Browser-Setup in Nuxt **unverifiziert** (Spike Aufgabe 4) |
| `vitest` / `@vue/test-utils` | 5.1.0 / 2.5.1 | npm, Plan 0a | Komponenten- und Contract-Tests |
| `playwright` / `@axe-core/playwright` | 1.64.1 / 4.14.0 | npm | E2E und Barrierefreiheit gegen den Mock-Modus |

Annahmen:

- A1 **Umsetzung durch einen Agenten** auf Branch `feat/frontend` (Kebab-Case nach Projektregel), Push erst nach vollständigem Stack, nichts in diesem Auftrag committet. Umsetzung mit Sonnet 5.5 oder Haiku, Review mit Opus.
- A2 **Startpunkt (Meilenstein „Gerüst steht“):** Das Frontend beginnt erst, wenn das Gerüst von Phase 0a steht. `phase-0a.md` benennt keinen Meilenstein „Gerüst steht“ ausdrücklich (Stand der Prüfung: nur Task 1 bis 12); **Festgelegt in `phase-0a.md` (Abschnitt 3.1, Abnahme A10):** Meilenstein „Gerüst steht“ ist das Ende von 0a Task 1 mit dem Commit `chore: nuxt scaffold` (Nuxt-Gerüst, `package.json`, `nuxt.config.ts`, Lockfile, ESLint, leeres `shared/api-types.ts`, Platzhalter-`app/app.vue`; ohne Tailwind und shadcn). Tailwind, shadcn-vue und die Basiskomponenten legt das Frontend selbst an (Aufgabe 1). Bis dahin arbeitet das Frontend **nicht** an `package.json` und `nuxt.config.ts` und legt kein zweites Gerüst an; erlaubt ist nur Vorarbeit ohne diese Dateien (Vertrag `shared/api-types.ts`, Entwurf der Mock-Handler und Seed unter `mocks/`, Label-Tabelle, Texte). Sobald der Meilenstein steht, ergänzt Aufgabe 1 die eigenen Schlüssel in diesen Dateien. 
- A3 **Vue-Seiten gehören dem Frontend** (entschieden 2026-11-04, Frage 1). Das Frontend übernimmt alle `app/**`-Dateien (Seiten, Layouts, Komponenten). Die Seiten, die 0a Task 9, 0b Aufgaben 3 bis 5 und Phase 1 Aufgaben 1.1.8 bis 1.1.10, 1.3.5 nennen, werden hier gebaut; die Backend-Phasen liefern API, Tests und Vertragsbeiträge (`shared/api-types.ts`). Das gilt auch für Login, Registrierung und Einladung annehmen, die die Backend-Phasen nicht mehr bauen (Aufgabe 7). Die Backend-Pläne sind entsprechend zu kürzen (Erwartung, Risiko R2).
- A4 **Sprache:** Oberfläche deutsch, API-Werte englisch (Enums wie `auth_expired`), Anzeige über Label-Tabelle `app/lib/labels.ts`.
- A5 **Datenabruf im angemeldeten Bereich nur auf dem Client** (`useAsyncData(..., { server: false })`). Grund: gleiches Verhalten mit Mock (SPA) und echt (SSR-Shell), keine Cookie-Weitergabe im SSR. `/login`, `/register`, `/consent` dürfen SSR nutzen.
- A6 **Polling statt Push**: Auto-Refresh 15 s / 30 s / 1 min / aus; pausiert bei verstecktem Tab.
- A7 **Scope-Namen, Statusnamen, Limits** wie in Abschnitt 4 des Abgleichs empfohlen (W1, W2, W4, W6).
- A8 **Dunkelmodus nach Phase 2** (entschieden 2026-11-04, Frage 8): bis dahin nur Hell, die Auswahl „System“ und „Dunkel“ ist ausgeblendet; die Tokens sind so benannt, dass `.dark` später nur Werte ergänzt.
- A10 **Gestrichen** (entschieden 2026-11-04, Fragen 3 und 7): Tags, Gerätenamen, E-Mail-Änderung, Benachrichtigungsmails, Konto-Selbstlöschung. „Alle testen“ erst später (Aufgabe 16). Verfügbarkeit und Heatmap nur mit `health-history` aus Phase 2.
- A9 **Ein Mandant pro Browsersitzung**: kein Nutzerwechsel ohne Abmelden; Stores werden beim Abmelden geleert.

## 3. Erwartungen an die Backend-Phasen

Das Frontend setzt voraus, was die Pläne zusagen, und nennt Ergänzungen als Wunsch an die Backend-Agenten (kein Eingriff in `server/`). Jede Zeile prüfen, sobald die Phase fertig ist.

| # | Erwartung | Phase | Plan sagt es zu |
|---|---|---|---|
| E1 | Better-Auth-Endpunkte unter `/api/auth/*` (Sign-up, Sign-in, Sign-out, `get-session`), Nutzer enthält `role` und `banned`; Fehler 403 „Registrierung geschlossen“ | 0a | ja |
| E2 | Sitzungsfunktionen `update-user`, `change-password`, `list-sessions`, `revoke-session` (Better-Auth-Kern, Namen **unverifiziert**) | 0a | nein |
| E3 | Mindestlänge Passwort 12 serverseitig (W12) | 0a | nein |
| E4 | `/api/oauth/consent-info` liefert Client, Redirect-URIs, `allowlisted`, `registeredAt`, `viaDcr`, Scopes mit Titel, `resource`, `loopback`; die Zustimmung nimmt eine Teilmenge der Scopes an (`mcp:tools` immer enthalten, `mcpwarden:admin` abwählbar, Entscheidung 5); ob der Better-Auth-Consent die Teilmenge unterstützt, ist **unverifiziert** | 0b (Teilmenge ab Phase 2) | teils |
| E5 | `/api/me/pats`, `/api/me/connections`, `/api/admin/oauth/*` wie 0b Aufgaben 3 und 5; PAT-Anzeigepräfix `mcpw_pat_` + 4 Zeichen (W13) | 0b | ja (Präfix: Wunsch) |
| E6 | `/api/upstreams*` wie 1.1.7/1.1.8/1.2.2 (CRUD, Secret, Test, Tools, Tool-Schalter); Antworten ohne Secret, mit `hasSecret` | 1 | ja |
| E7 | Listenfelder `toolsEnabled`, `toolsTotal`, `statusReason`, `nextRetryAt`, `setup` (W1); später `p95Ms`, `recent` | 1 / 2 | nein (Wunsch) |
| E8 | `GET /api/me/capabilities` mit stdio-Erlaubnis und Grund (1.3.5) und Limits | 1 | teils |
| E9 | Admin-Routen `users`, `invites`, `settings` wie 1.1.9, 1.1.10, 1.3.5; Nutzerliste mit `lastActivityAt`, `stdioAllowed`, `limits` | 1 | teils |
| E10 | Fehlerform einheitlich `{ statusCode, statusMessage, data:{ code, field?, message } }` (h3-`createError`) | alle | nein (Wunsch) |
| E11 | `GET /api/audit` (Lesen; Nutzer eigene Einträge, Admin zusätzlich Instanzereignisse, Entscheidung 6) und `GET /api/dashboard` (Clients, Aufmerksamkeit, ohne KPIs) schon in Phase 1 (entschieden 2026-11-04, Entscheidung 4) | 1 | nein (Plan 1 anzupassen) |
| E13 | Einladung als Token-Link: `POST/GET/DELETE /api/admin/invites` (Token nur beim Erzeugen im Link, 7 Tage, optional E-Mail-Bindung), `GET /api/invites/:token` (öffentlich: gültig, gebundene E-Mail, Ablauf), Registrierung mit Token über Sign-up (Entscheidung 2) | 1 | nein (Plan 1 hat E-Mail-Allowlist, anzupassen) |
| E14 | Backend-Phasen bauen keine `app/**`-Dateien mehr, auch nicht Login und Registrierung (Entscheidung 1) | 0a bis 1 | nein (Pläne zu kürzen) |
| E12 | Statistik-, Verlauf-, Link-, Freigabe-Routen aus Abgleich Abschnitt 5 | 2 | kein Plan |

Sobald `shared/api-types.ts` steht (Aufgabe 3), prüfen die Backend-Agenten ihre Antworten mit `satisfies` gegen diese Typen. Änderungen am Vertrag laufen als kleine, abgesprochene Commits (Abschnitt 4).

## 4. Eigentum, Verzeichnisstruktur und Vertrag an der Grenze

**Dem Frontend gehören:** `app/**` (alle Seiten, Layouts und Komponenten, auch Login, Registrierung, Einladung; entschieden 2026-11-04), `mocks/**`, `shared/api-types.ts` (Erstfassung, danach gemeinsam), `public/mockServiceWorker.js` (generiert), `tests/ui/**`, `components.json`, `.github/workflows/ui.yml`. **Gemeinsam (nur eigene Schlüssel anfassen):** `package.json` (eigene Abhängigkeiten, Skripte mit Präfix `ui:`), `nuxt.config.ts` (nur `ssr`, `modules` Einträge `shadcn-nuxt` und `@nuxtjs/color-mode`, `css`, `vite.plugins`, `shadcn`, `colorMode`, `app.head`). **Tabu für das Frontend:** `server/**`, `supervisor/**`, `tests/integration/**`, `tests/unit/**`, `tests/helpers/**`, `drizzle.config.ts`, `compose*.yaml`, `Dockerfile`, `.github/workflows/ci.yml`, Migrationen.

```
mcpwarden/
├── app/
│   ├── app.vue                         # <NuxtLayout><NuxtPage/></NuxtLayout>, <Toaster/>
│   ├── error.vue
│   ├── assets/css/tailwind.css         # Tokens (Abschnitt 7), @font-face über @fontsource
│   ├── layouts/{default,auth}.vue
│   ├── middleware/{auth.global,admin}.ts
│   ├── plugins/{ssr-width,msw.client}.ts
│   ├── pages/
│   │   ├── index.vue                   # Dashboard
│   │   ├── login.vue · register.vue · consent.vue
│   │   ├── invite/[token].vue          # Einladung annehmen (entschieden 2026-11-04)
│   │   ├── link/[token].vue · link/done.vue          # Phase 2
│   │   ├── upstreams/index.vue · new.vue
│   │   ├── upstreams/[id]/index.vue · edit.vue · approve.vue
│   │   ├── stats.vue · audit.vue
│   │   ├── settings/index.vue · tokens.vue · connections.vue
│   │   └── admin/index.vue (Redirect) · users.vue · oauth.vue · settings.vue
│   ├── components/
│   │   ├── ui/…                        # shadcn-vue (CLI-erzeugt, nur Varianten anpassen)
│   │   ├── shell/{AppSidebar,PageHeader,AdminTabs,MockBanner}.vue
│   │   ├── common/{StatusBadge,StatusDot,KpiCard,EmptyState,ErrorState,LoadingRows,ConfirmDialog,CopyButton,OneTimeSecret,SecretField,TimeWindow,AutoRefresh,RelativeTime,SparkBars,Heatmap,DataSection}.vue
│   │   ├── upstreams/{UpstreamForm,HttpFields,StdioFields,RestFields,SlugField,ToolTable,TestResult,ErrorBreakdown,SetupHint}.vue
│   │   ├── access/{ScopeList,ClientWarning,RedirectDisplay,PatTable,ConnectionTable}.vue
│   │   ├── admin/{UserTable,InviteDialog,LimitsDialog,AllowlistTable,AllowlistDialog,ClientRegistrations,SsrfList}.vue
│   │   └── stats/{LatencyChart,CallsChart,OutcomeBars,PercentileTable}.vue
│   ├── composables/{useApi,useSessionUser,usePolling,useAttentionCount,useSidebarState,useFormatters}.ts
│   ├── api/{http,auth,upstreams,me,oauth-admin,admin,stats,audit,links,dashboard}.ts      # typisierter Client
│   └── lib/{auth-client,utils,labels,nav,zod-schemas}.ts
├── shared/api-types.ts                 # Vertrag (nur Typen und Konstanten, kein Vue, kein Nitro)
├── mocks/
│   ├── handlers/{auth,oauth,me,admin-oauth,upstreams,admin,stats,audit,links,dashboard}.ts
│   ├── state.ts · seed.ts · scenarios.ts · browser.ts · node.ts · index.ts
├── (.mocks-public/mockServiceWorker.js)  # generiert (msw init), gitignoriert, nur bei Mock-Builds per nitro.publicAssets
└── tests/ui/{vitest.config.ts,unit,component,contract,e2e}/
```

**Vertrag an der Grenze:** `shared/api-types.ts`, importiert als `#shared/api-types` (Alias laut Nuxt-Doku; die Datei liegt direkt unter `shared/`, wird also **nicht** automatisch importiert, nur explizit). Inhalt: je Route `Request`- und `Response`-Typ, Enums (`UpstreamHealth`, `UpstreamSetup`, `CallOutcome`, `Role`, `DcrMode`, `ToolMode`, `AuthType`, `UpstreamType`), `ApiErrorBody`, Pfadkonstanten. Regeln:

1. Nur Typen und Konstanten; keine Laufzeitlogik, kein Import von Vue oder Nitro (Nuxt-Doku: geteilter Code darf beides nicht importieren).
2. Zeitstempel als ISO-8601-String, Zahlen in Millisekunden mit Suffix `Ms`, Prozent als Anteil 0 bis 1.
3. Secrets kommen nie in Antworttypen vor, nur `hasSecret: boolean` und Eingabetypen (`SecretInput`).
4. Feld hinzufügen ist abwärtskompatibel; Umbenennen oder Entfernen verlangt Absprache mit dem Backend-Agenten und ändert Mock, Contract-Test und Client im selben Commit.
5. Die Erstfassung stammt aus Abgleich Abschnitt 5; die Backend-Agenten ergänzen, was sie anders bauen, im selben Commit wie die Route.

## 5. Routenkarte

Layout: `default` = Seitenleiste + Inhalt, `auth` = zentrierte Karte ohne Navigation. „Mock“ nennt die Mock-Domäne (Abschnitt 13). „Echt ab“ nennt die Phase, ab der die Seite gegen echte Daten läuft.

| Seite | Pfad | Datei | Layout | Rolle | Benötigte API | Mock | Echt ab |
|---|---|---|---|---|---|---|---|
| Dashboard | `/` | `pages/index.vue` | default | Nutzer | `GET /api/dashboard` (ohne KPIs), `GET /api/upstreams` (Badge) | dashboard | 1 (Clients, Aufmerksamkeit; entschieden 2026-11-04) / 2 (KPIs, Diagramm) |
| Anmelden | `/login` | `pages/login.vue` | auth | öffentlich | `POST /api/auth/sign-in/email`; Fortsetzung der OAuth-Query | auth | 0a (Seite: Frontend) |
| Registrieren | `/register` | `pages/register.vue` | auth | öffentlich | `POST /api/auth/sign-up/email` | auth | 0a (Seite: Frontend) |
| Einladung annehmen | `/invite/[token]` | `pages/invite/[token].vue` | auth | öffentlich | `GET /api/invites/:token`, Sign-up mit Token | admin | 1 (Token-Link, 7 Tage, optional an E-Mail gebunden; entschieden 2026-11-04) |
| Zustimmung | `/consent` | `pages/consent.vue` | auth | angemeldet | `GET /api/oauth/consent-info`, `authClient.oauth2.consent` (zwei Scope-Schalter, Admin-Schalter ab Phase 2) | oauth | 0b |
| Auth-Link | `/link/[token]` | `pages/link/[token].vue` | auth | angemeldet (Besitzer) | `GET/POST /api/links/:token…` | links | 2 |
| Auth-Link Ende | `/link/done` | `pages/link/done.vue` | auth | angemeldet | Query `status` | links | 2 |
| Upstreams | `/upstreams` | `pages/upstreams/index.vue` | default | Nutzer | `GET /api/upstreams`, `POST /api/upstreams/:id/test` | upstreams | 1 |
| Upstream anlegen | `/upstreams/new` | `pages/upstreams/new.vue` | default | Nutzer | `POST /api/upstreams`, `GET /api/me/capabilities`, `PUT …/secret` | upstreams | 1 |
| Upstream-Detail | `/upstreams/[id]` | `pages/upstreams/[id]/index.vue` | default | Nutzer | `GET /api/upstreams/:id`, `…/tools`, `PUT …/tools/:name`, `…/test`, `PATCH`, `DELETE`, ab 2 `…/stats`, `…/health-history` | upstreams, stats | 1 (Übersicht, Tools, Auth) / 2 (Kurven) |
| Upstream bearbeiten | `/upstreams/[id]/edit` | `pages/upstreams/[id]/edit.vue` | default | Nutzer | `GET`, `PATCH`, `PUT …/secret` | upstreams | 1 |
| stdio-Freigabe | `/upstreams/[id]/approve` | `pages/upstreams/[id]/approve.vue` | default | Nutzer (stdio erlaubt) | `GET /api/upstreams/:id`, `POST …/approve`, `DELETE` | upstreams | 2 |
| Statistik | `/stats` | `pages/stats.vue` | default | Nutzer (Admin: Instanzteil) | `GET /api/stats/*`, `GET /api/admin/stats` | stats | 2 |
| Audit | `/audit` | `pages/audit.vue` | default | Nutzer (eigene) / Admin (eigene + Instanzereignisse) | `GET /api/audit` | audit | 1 (E11, entschieden 2026-11-04) |
| Einstellungen | `/settings` | `pages/settings/index.vue` | default | Nutzer | `/api/auth/update-user` (nur Name), `change-password`, `list-sessions`, `revoke-session`; ohne E-Mail-Änderung, Benachrichtigungen, Konto-Selbstlöschung | auth | 0a (Namen unverifiziert) |
| Tokens | `/settings/tokens` | `pages/settings/tokens.vue` | default | Nutzer | `GET/POST /api/me/pats`, `DELETE /api/me/pats/:id` | me | 0b |
| Clients | `/settings/connections` | `pages/settings/connections.vue` | default | Nutzer | `GET /api/me/connections`, `DELETE …/:clientId`, ab 3 `GET/PUT /api/me/preferences` | me | 0b / 3 |
| Admin: Nutzer | `/admin/users` | `pages/admin/users.vue` | default | Admin | `GET /api/admin/users`, `ban`, `unban`, `DELETE`, `PUT …/limits`, `GET/POST/DELETE /api/admin/invites` | admin | 1 |
| Admin: Clients (DCR) | `/admin/oauth` | `pages/admin/oauth.vue` | default | Admin | `GET/PUT /api/admin/oauth/policy`, `allowlist`, `clients` | admin-oauth | 0b |
| Admin: Instanz | `/admin/settings` | `pages/admin/settings.vue` | default | Admin | `GET/PUT /api/admin/settings` | admin | 1 |
| Fehler | `error.vue` | `app/error.vue` | default | alle | – | – | 0a |

Gestrichen (keine Route, kein Element): E-Mail-Änderung, Benachrichtigungen, Konto löschen, Tags-Filter, Gerätenamen, „Alle testen“ (bis später). Die Karten „Verfügbar x %“ und Heatmap im Detail erscheinen nur, wenn `health-history` (Phase 2) geliefert wird.

Beschriftungen der Navigation folgen dem Entwurf (Dashboard, Upstreams, Statistik, Clients, Tokens, Audit, Admin, Einstellungen); die Pfade folgen den Backend-Plänen (W16, W17). `/admin` leitet auf `/admin/users` weiter. Die Reiter von `Detail` (Übersicht, Tools, Auth, Aufrufe) sind Tabs in einer Seite mit `?tab=`; der Reiter „Aufrufe“ bleibt bis zum Aufruf-Log (Phase 3) ausgeblendet.

Middleware: `auth.global.ts` (aus 0a übernommen und erweitert) erlaubt ohne Sitzung nur `/login`, `/register`, `/invite/*`; sonst `navigateTo('/login?redirect=<Pfad>')`, wobei eine vom Plugin angehängte signierte OAuth-Query unverändert bleibt (0b R14). `admin.ts` prüft `role === 'admin'`, sonst Weiterleitung auf `/` mit Hinweis. Ein gesperrter Nutzer (`banned`) oder eine 401-Antwort führt zu `/login`.

## 6. Layout und Navigation

Die Entwürfe `Dashboard` (ausgeklappt) und `DashboardCollapsed` (eingeklappt) sind dieselbe Seite mit Zustand `collapsed`.

- **Bausteine:** shadcn-vue `Sidebar` (`SidebarProvider`, `Sidebar` mit `collapsible="icon"`, `SidebarHeader`, `SidebarContent`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`, `SidebarMenuBadge`, `SidebarFooter`, `SidebarRail`, `SidebarTrigger`, `useSidebar`). Doku bestätigt `defaultOpen`, `open`, `collapsible` (`icon`, `offcanvas`), `variant`, `useSidebar()` mit `state`, `open`, `setOpen`, `isMobile`, `openMobile`, `toggleSidebar`, Tastenkürzel Strg/Cmd+B. **Nicht in der Doku belegt (unverifiziert):** Cookie- oder `localStorage`-Persistenz mit festem Namen, die Variable `--sidebar-width-icon`, das Verhalten auf Mobilgeräten (vermutlich Sheet). Gegenmaßnahme: Persistenz selbst über `useSidebarState` (Cookie `sidebar_collapsed`, damit der erste Render stimmt), Breiten über `style` am `SidebarProvider` prüfen.
- **Maße:** ausgeklappt 248 px, eingeklappt 64 px (Entwurf). shadcn-Standard ist 16 rem und 3 rem; also `--sidebar-width: 248px` und `--sidebar-width-icon: 64px` setzen und im Browser prüfen.
- **Struktur (aus `lib/nav.ts`, eine Quelle):**

| Gruppe | Eintrag | Pfad | Icon-Pfad im Entwurf | Sichtbar für | Badge |
|---|---|---|---|---|---|
| Betrieb | Dashboard | `/` | Haus | alle | – |
| Betrieb | Upstreams | `/upstreams` | vier Kacheln | alle | Zahl der Upstreams mit `degraded`, `open`, `auth_expired` (Annahme, Abgleich Punkt 9) |
| Betrieb | Statistik | `/stats` | Kurve | alle | – |
| Zugang | Clients | `/settings/connections` | Monitor | alle | – |
| Zugang | Tokens | `/settings/tokens` | Schlüssel | alle | – |
| System | Audit | `/audit` | Dokument | alle | – |
| System | Admin | `/admin/users` | Schild | nur Admin | – |
| unten | Einstellungen | `/settings` | Regler | alle | – |

- **Eingeklappt:** nur Icons (20 px), Gruppenüberschriften werden zu einer 1-px-Linie, Badges zu einem 8-px-Punkt oben rechts, jedes Element behält `aria-label` und `title` (Tooltip über `Tooltip`). Fokus und Tastatur funktionieren identisch.
- **Kopf des Inhalts:** `PageHeader` mit Brotkrumen „Home › Seite“ (`Breadcrumb`), `h1` 20 px, optional Beschreibung (13 px) und rechts Aktionen (Zeitfenster, Auto-Refresh, Primäraktion). Eine `h1` je Seite.
- **Fuß der Leiste:** Nutzerblock (Initialen im Kreis 32 px, Name, E-Mail mit Ellipsis) und Knopf „Einklappen“; kein Abmelden-Link im Entwurf, daher Menü am Nutzerblock (`DropdownMenu`: Einstellungen, Abmelden) als Ergänzung.
- **Mobil (< 700 px):** Der Entwurf wandelt die Leiste in eine waagerechte, scrollbare Leiste um. Plan: shadcn-Sidebar im Off-Canvas-Modus (`Sheet`) mit `SidebarTrigger` im Kopf. Das weicht vom Entwurf ab und ist besser bedienbar; Abnahme per Sichtprüfung bei 375 px (Entscheidung im Review nachziehen, falls die waagerechte Leiste gewünscht ist).
- **Inhalt:** `main` mit Innenabstand 16/24/32 px, Abstand zwischen Karten 16 px, Tabellen in `overflow-x-auto` mit Mindestbreite (Entwurf: 720 bis 1040 px).
- **Weitere Elemente:** Skip-Link „Zum Inhalt“, `MockBanner` (nur im Mock-Modus, mit Rollenwechsel), `Toaster` unten rechts.
- **Admin-Tabs:** `AdminTabs` (Nutzer, Clients (DCR), Instanz) als Unternavigation mit `aria-current="page"`, nicht als `role="tab"` (Abgleich Abschnitt 12).

## 7. Design-Tokens und Typografie

Quelle: Stilangaben in den `.dc.html`-Dateien (Inline-Styles). Der Entwurf nutzt die Tailwind-Zinc-Hexwerte; Tailwind v4 liefert die Paletten in `oklch`, die Abweichung ist minimal, **maßgeblich sind die Hexwerte des Entwurfs** (Farben als Hex in `tailwind.css` setzen, nicht aus der Palette beziehen). Die Namen folgen den shadcn-Variablen (Doku: `--background`, `--foreground`, `--primary`, `--muted`, `--border`, `--input`, `--ring`, `--destructive`, `--radius`, `--sidebar-*`, `--chart-n`, in `:root` und `.dark`).

**Farben (Hell):**

| Token | Wert | Verwendung im Entwurf |
|---|---|---|
| `--background` | `#f4f4f5` | Seitenhintergrund |
| `--card` | `#ffffff` | Karten, Tabellen, Seitenleiste, Eingabefelder |
| `--foreground` | `#18181b` | Text, `h1` |
| `--secondary-foreground` | `#3f3f46` | Zelltext, inaktive Navigation |
| `--muted-foreground` | `#52525b` | Brotkrumen, Hilfetexte, Tabellenkopf, Gruppenüberschrift |
| `--border` | `#e4e4e7` | Kartenrand, Trennlinien, Eingaberand |
| `--input-strong` | `#a1a1aa` | Rand des Secret-Feldes im Fokuskontext (`AuthLink`), Rand ausgewählter Berechtigung |
| `--muted` | `#f4f4f5` | Zeilentrenner, Fortschrittsbalken-Grund, Seitenfuß der Tabelle, Suchfeld im Detail |
| `--table-head` | `#fafafa` | Tabellenkopf, aktiver Berechtigungskasten |
| `--primary` (Akzent) | `#3730a3` | Primärknopf, aktiver Navigationspunkt, Links, Auswahlrand, Kennzahl-Diagramm; wählbar `#0f766e`, `#18181b`, `#b91c1c` (Eigenschaft `accent`) |
| `--primary-foreground` | `#ffffff` | Text auf Akzent |
| `--primary-tint` | `#eef2ff` | gewählte Kachel, gewählter Eintrag in der Upstream-Liste (für andere Akzente per `color-mix` ableiten, **unverifiziert**) |
| `--destructive` | `#991b1b` | Text „Widerrufen“, „Sperren“-Warnungen |
| `--destructive-soft` | `#b91c1c` | Löschen-Knopf, Fehlerpunkt Statuskarte |
| `--destructive-border` | `#fecaca` | Rand der Gefahrenknöpfe und -karten |
| `--nav-badge` | `#991b1b` | Zähler in der Navigation (Text `#ffffff`) |

**Statusfarben (immer Punkt oder Chip plus Text):**

| Zustand | Chip Hintergrund | Chip Text | Punkt/Balken | Entwurfsstelle |
|---|---|---|---|---|
| healthy | `#dcfce7` | `#166534` | `#15803d` (Karte), `#16a34a` (Balken) | Main, Detail |
| degraded | `#fef3c7` | `#92400e` | `#b45309`, Balken `#d97706`, Heatmap `#f59e0b` | Main, Detail |
| open | `#fee2e2` | `#991b1b` | `#b91c1c`, Balken `#dc2626`, Heatmap `#991b1b` | Main, Detail |
| auth_expired | `#dbeafe` | `#1e40af` | `#1d4ed8` | Main |
| disabled | `#f4f4f5` | `#3f3f46` | `#71717a`, Balken „keine Daten“ `#e4e4e7` | Main |
| Online (Client) | – | `#166534` | gleiche Farbe | Dashboard, Clients |
| Inaktiv (Client) | – | `#3f3f46` | gleiche Farbe | Dashboard |

**Hinweisboxen:** Warnung Hintergrund `#fef3c7`, Text `#78350f`, Rand `#fcd34d` (Consent, StdioFreigabe, Detail). Erfolg Hintergrund `#dcfce7`, Text `#14532d`, Rand `#86efac` (Token-Banner, Einladung, Testergebnis). „Keine Daten“ in der Heatmap: Schraffur `repeating-linear-gradient(45deg, #f4f4f5, #f4f4f5 3px, #d4d4d8 3px, #d4d4d8 4px)`. Diagrammlinien in `Detail`: p50 `#1d4ed8` durchgezogen, p95 `#b45309` gestrichelt `6 3`, p99 `#3f3f46` gepunktet `2 3` (Unterscheidung nicht nur über Farbe).

**Typografie:** Familien Inter (400, 500, 600, 700) und JetBrains Mono (400, 500), lokal über `@fontsource-variable/*` (Import-Pfade **unverifiziert**), Fallback `system-ui` und `ui-monospace, monospace`. Grundschrift 14 px, Zeilenhöhe 1.4 (Karten- und Formularseiten 1.45).

| Rolle | Größe / Gewicht | Zusatz |
|---|---|---|
| `h1` Seite | 20 px / 600 | Laufweite -0.01em |
| `h1` Auth-Karte | 18 px / 600 | |
| `h2` Abschnitt (Admin, Settings) | 16 px / 600 | |
| `h2`/`h3` Karte | 15 px / 600 | |
| Detail-Titel | 18 px / 600 | |
| Fließtext, Tabellenzelle | 14 px / 400 | |
| Beschriftung, Brotkrumen-Zusatz, Hilfetext | 12 bis 13 px | `--muted-foreground` |
| Tabellenkopf | 12 px / 500 | `--muted-foreground` |
| Kennzahl | 24 px / 700 (Dashboard, Upstreams), 22 px (Detail, Statistik) | `font-variant-numeric: tabular-nums` |
| Navigation | 14 px / 500; Marke 15 px / 700 | |
| Gruppenüberschrift | 11 px / 600, Großbuchstaben, 0.04em | |
| Chip / Badge | 12 px / 500 (Zähler 11 px / 600) | |
| Code, URLs, Befehle, Tool-Namen | JetBrains Mono 12 bis 13 px | `overflow-wrap: anywhere` |

**Form und Maße:**

| Eigenschaft | Wert |
|---|---|
| Radius Bedienelemente (Knopf, Eingabe, Box) | 6 px |
| Radius Karten, Kachel-Statistiken | 10 px |
| Radius Logo, Auth-Logo | 8 px; Chips 999 px; kleine Tags 4 px; Balken 2 bis 3 px |
| Höhe Knöpfe, Eingaben, Navigationseinträge | 44 px (Tabs 40 px im Umschalter, Navigation min. 44 px) |
| Karteninnenabstand | 14 bis 20 px; Tabellenzeilen 8 px senkrecht, 20 px seitlich; Raster-Lücke Tabellen 12 px |
| Auth-/Consent-Karte | max. 480 px, Innenabstand 28 px, Schatten `0 1px 2px rgba(0,0,0,0.05)`; Formularkarte 600 px |
| Inhalt Einstellungen | max. 720 px |
| Seitenleiste | 248 / 64 px, Innenabstand 12/8 px, Eintragshöhe 44 px, Icon 20 px |

shadcn-vue-Doku: `--radius` Standard 0,625 rem (10 px), abgeleitet 0,6× (6 px), 0,8× (8 px), 1× (10 px). Damit ergeben `rounded-sm` die 6 px der Bedienelemente und `rounded-lg` die 10 px der Karten; Button und Input aus der CLI nutzen standardmäßig eine andere Stufe und werden in Aufgabe 2 auf `rounded-sm` und Höhe 44 px gesetzt (Ableitungsfaktoren aus der Doku, Ergebnis im Build prüfen).

**Zahlen und Zeit:** Dezimalkomma, Tausendertrenner als schmales geschütztes Leerzeichen wie im Entwurf („1 840“, „9 874“); Hilfsfunktion `formatNumber` statt `toLocaleString`, weil `de-DE` einen Punkt liefert. Einheiten mit Leerzeichen („212 ms“, „60 s“, „98,7 %“). Relative Zeit über `Intl.RelativeTimeFormat('de')` („vor 8 s“), absolute Daten `TT.MM.JJJJ`, „heute HH:MM“ im Audit.

**Mikrotexte und Begriffe (Glossar, `lib/labels.ts`):** Status wie Abgleich W1 (Vorschlag: „In Ordnung“, „Eingeschränkt“, „Breaker offen“, „Auth abgelaufen“, „Deaktiviert“, „Unbekannt“; bis zur Freigabe die Entwurfswörter „Healthy“/„Degraded“); Aufrufstatus deutsch mit Rohwert in `title` (`ok` = „Erfolgreich“, `tool_error` = „Tool-Fehler“, `timeout` = „Timeout“, `upstream_error` = „Upstream-Fehler“, `rate_limited` = „Rate-Limit“, `breaker_open` = „Breaker offen“, `denied` = „Abgelehnt“); Scope `mcp:tools` = „Tools auflisten und aufrufen“, `mcpwarden:admin` = „Upstreams verwalten“; Tool-Art lesend / schreibend / löschend aus `readOnlyHint` / `destructiveHint` (sonst „unbekannt“); Einheit „Aufrufe“ statt „Calls“.

## 8. Komponentenliste

**shadcn-vue (per `pnpm dlx shadcn-vue@latest add …`, alle in der Doku vorhanden):** `button`, `input`, `label`, `card` (0a), `table`, `dialog`, `alert-dialog`, `alert`, `badge`, `select`, `checkbox`, `radio-group`, `switch`, `tabs`, `tooltip`, `dropdown-menu`, `sheet`, `sidebar`, `skeleton`, `sonner`, `separator`, `breadcrumb`, `field`, `input-group`, `textarea`, `empty`, `spinner`, `scroll-area`, `toggle-group`, `collapsible`, `pagination`; Phase 2 zusätzlich `chart` (Unovis). `form` wird **nicht** installiert (Doku: nicht weiterentwickelt).

| Bedarf im Entwurf | Baustein |
|---|---|
| Tabellen (Upstreams, Clients, Tokens, Audit, Nutzer, Allowlist, Statistik, Tools) | `Table` in `DataSection` (Karte, Titel, Beschreibung, horizontales Scrollen, Seitenfuß); echte `<table>` mit `caption` (sr-only), nicht CSS-Grid |
| Kennzahlen | `KpiCard` (Label, Wert, Einheit, Notiz, optional Statuspunkt/Balken) |
| Status | `StatusBadge` (Chip mit Punkt und Text, Props `status`, optional `reason`); `StatusDot` für Client-Status |
| Zeitfenster 5 min / 1 h / 24 h / 7 d | `TimeWindow` auf `ToggleGroup` (Einfachauswahl, `aria-label`) |
| Auto-Refresh | `AutoRefresh` (`Select`: aus, 15 s, 30 s, 1 min) + `usePolling` |
| Balken „letzte 24“ | `SparkBars` (24 `span`, `aria-hidden`, Text-Alternative: „Letzte 24 Einträge: 22 ohne Fehler, 2 mit Fehlern“) |
| Heatmap | `Heatmap` (7 × 24, `title` je Zelle, Legende, Tabellenalternative per Knopf „Als Tabelle anzeigen“) |
| Verlaufsdiagramme | `chart` (Unovis) für `CallsChart`, `LatencyChart`; Phase 2 |
| Fehleranteile, Ergebnis der Aufrufe | `OutcomeBars` (Label, Balken, Anzahl; reines CSS) |
| Berechtigung wählen (Tool-Modus, DCR-Modus, Typ, Anmeldeart) | `RadioGroup` in umrandeten Kacheln (gewählt: Rand Akzent, Hintergrund `--primary-tint`); Typ- und Anmeldeart-Kacheln als `RadioGroup`, nicht als Knopf mit `aria-pressed` |
| Schalter (Tool aktiv, stdio, Instanz) | `Switch` (Entwurf nutzt Checkbox; Schalter mit Label und `aria-checked`); stdio je Nutzer `Checkbox` |
| Bestätigungen | `AlertDialog` über `ConfirmDialog` (Titel, Folgen, Knopf rot) für Löschen, Widerrufen, Sperren, Verwerfen |
| Einmalig sichtbare Werte | `OneTimeSecret` (Banner `role="status"`, Wert in `code`, `CopyButton`, Schließen löscht den Wert) |
| Secret-Eingabe | `SecretField` (`InputGroup` mit `type=password` und Knopf „Anzeigen“) |
| Leer / Fehler / Laden | `EmptyState` (`Empty`), `ErrorState` (Meldung, Fehlercode, „Erneut versuchen“), `LoadingRows` (`Skeleton`) |
| Benachrichtigungen | `Toaster` (sonner) für Erfolg/Fehler kurzer Aktionen; Fehler mit Handlungsbedarf bleiben im Inhalt |
| Warnbox | `Alert` mit Varianten `warning`, `success`, `destructive` |
| Zeit | `RelativeTime` (`<time datetime>` mit relativem Text, `title` absolut) |
| Konsent | `ScopeList`, `ClientWarning`, `RedirectDisplay` (Host fett, Rest gedämpft) |
| Slug | `SlugField` (Eingabe, Live-Vorschau `<slug>__tool`, Zähler x/32, Regex-Hinweis) |
| Formularzeilen | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldGroup`, `FieldSet`, `FieldLegend` (Doku bestätigt) |

Icons: die Entwurfs-Pfade (24 × 24, Strich 1.8, runde Enden) werden durch die Icons der in `components.json` gewählten Bibliothek ersetzt; nur wenn kein passendes Icon existiert, den Pfad des Entwurfs in `components/common/icons/` ablegen.

## 9. Formulare und Validierung

Technik: `vee-validate` (`useForm`, `Field`-Familie) mit zod-Schemas aus `lib/zod-schemas.ts` (`toTypedSchema`, Doku-Weg; Zod-4-Verträglichkeit per Spike in Aufgabe 2, Fallback Schema-Fehlerliste direkt in `FieldError`). Regeln: Clientvalidierung ist Komfort, der Server entscheidet; Fehler des Servers (`data.field`, `data.code`) werden dem Feld zugeordnet, unbekannte Felder erscheinen als Alert über dem Formular. Fehlermeldung am Feld per `FieldError`, `data-invalid` am `Field`, `aria-invalid` und `aria-describedby` am Eingabefeld, Fokus auf das erste fehlerhafte Feld nach dem Absenden. Doppelklick-Schutz: Senden-Knopf zeigt `Spinner` und ist deaktiviert (`aria-busy`). Ungespeicherte Änderungen: Warnung beim Verlassen nur in Bearbeitungsformularen.

| Formular | Felder und Regeln | Quelle der Regel |
|---|---|---|
| Anmelden | E-Mail (Format), Passwort (nicht leer) | 0a |
| Registrieren | Name, E-Mail, Passwort ≥ 12 (nur wenn Server es erzwingt, E3), Bestätigung; bei 403 Meldung „Registrierung nur mit Einladung“ | 0a, Plan 1 |
| Einladung annehmen (`/invite/<token>`) | Name, E-Mail (vorbelegt und gesperrt, wenn die Einladung an eine E-Mail gebunden ist), Passwort ≥ 12, Bestätigung; Token aus der Adresse, nicht als Formularfeld; Fehlerseiten für ungültig, abgelaufen (7 Tage), bereits verwendet | Entscheidung 2, E13 |
| Upstream HTTP | Typ; Kurzname-Slug `^[a-z0-9][a-z0-9-]{0,31}$` (eindeutig: Server 409); Anzeigename (nicht leer); URL `http(s)`, kein Userinfo; Transport `auto/streamable/sse` (Standard `auto`, in „Erweitert“); Anmeldeart `none/bearer/header` (`oauth` ab Phase 2, vorher ausgeblendet); bei `bearer` Secret; bei `header` Header-Name (Token-Zeichen, **Annahme** `^[A-Za-z0-9-]{1,64}$`) und Secret | Spec P0-1, Plan 1.1.6 |
| Upstream stdio | Befehl (nicht leer), Argumente (Liste), `cwd` relativ ohne `..`, Env-Name/Wert-Paare (Wert = Secret, maskiert); Feld nur aktiv, wenn `capabilities.stdio.allowed`, sonst Sperrgrund aus der API | Spec P0-5, Plan 1.1.6, 1.3.5 |
| Upstream REST (Phase 2) | Name, Beschreibung, Methode, URL-Template mit `{param}`, Header/Query/Body-Templates, JSON-Schema (Editor mit Parse-Prüfung), Secret-Referenz, Timeout, Größenlimit | Spec P0-8 |
| Erweitert (alle) | Aufrufe/min ganze Zahl ≥ 1 (Standard 60), Parallel ≥ 1 (Standard 5), Timeouts Verbinden/Liste/Aufruf in Sekunden (Standard 10/15/60), Obergrenzen vom Server (`limits`), **Annahme** Maximum 600 s | Spec P0-5, P0-14 |
| Secret ersetzen | ein Feld, Pflicht, nach Erfolg geleert; kein Vorbefüllen | Spec P0-6 |
| PAT erzeugen | Name Pflicht, ≤ 64 Zeichen; Server begrenzt auf 20 aktive | Plan 0b Aufgabe 5 |
| Auth-Link Token | Secret Pflicht; „Testen“ vor „Speichern“ optional | Spec P0-12 |
| Einladung erzeugen | E-Mail optional (Format; bindet die Einladung an diese Adresse), Ablauf fest 7 Tage (kein Eingabefeld); Ergebnislink `/invite/<token>` einmalig | Spec P0-4, Entscheidung 2 |
| Consent | Schalter `mcp:tools` (an, nicht abwählbar), Schalter `mcpwarden:admin` (abwählbar; bis Phase 2 nicht gerendert), Pflicht-Checkbox bei unbekanntem Client | Entscheidung 5 |
| Nutzerlimits | `max_upstreams`, `calls_per_min`, `max_connections`, `stdio_max_procs`, `stdio_idle_min`, `stdio_allowed`; ganze Zahlen ≥ 1, Standardwerte aus der API | Plan 1 Abschnitt 4.2 |
| Allowlist-Eintrag | Bezeichnung, Name-Muster, Redirect-Muster (Zeilenliste; Muster nur auf Nicht-Leere prüfen, `*` nur wie vom Server erlaubt) | Plan 0b Aufgabe 3 |
| SSRF-Ausnahme | CIDR oder Hostname; Hinweis zu Metadaten-IPs; Server validiert | Plan 1.1.5, W9 |
| Einstellungen | Name; Passwortwechsel (aktuell, neu ≥ 12); Darstellung (nur „Seitenleiste eingeklappt als Standard“; Farbschema-Auswahl erst nach Phase 2). Kein E-Mail-Feld zum Ändern, keine Benachrichtigungsschalter, kein „Konto löschen“ | Entwurf, W12, Entscheidungen 3 und 8 |
| Import (Phase 3) | JSON-Textfeld oder Datei; Vorschau; Secrets nie erwartet | Spec P1 |

Entwurfsabweichung: Die Typ- und Anmeldeart-Kacheln sind `RadioGroup` (richtige Semantik und Pfeiltasten), nicht Knöpfe mit `aria-pressed`.

## 10. Umgang mit Secrets in der UI

Regeln (alle testbar):

1. **Nie anzeigen:** Antworttypen enthalten kein Secret (Vertrag Regel 3). Gespeicherte Secrets erscheinen als „Gesetzt“ (Badge) mit Knopf „Ersetzen“; das Feld startet leer.
2. **Nur im Speicher:** Eingegebene Werte liegen im lokalen Formularzustand, nicht in Pinia, `useState`, `localStorage`, `sessionStorage`, URL, Route-State oder Logs. Beim Verlassen der Seite, beim Abmelden und nach Erfolg wird der Wert überschrieben (`''`).
3. **Eingabefeld:** `type="password"`, `autocomplete="new-password"` bzw. `off`, `spellcheck=false`, Knopf „Anzeigen“ wirkt nur auf den eben eingetippten Wert (wie `AuthLink`). Beispielwerte (der Entwurf hat ein vorbefülltes Token) gibt es im UI und im Mock **nicht**.
4. **Einmalwerte (PAT, Einladungslink, Link-Token):** `OneTimeSecret` hält den Wert nur im Komponentenzustand, bietet Kopieren, verschwindet beim Schließen oder Navigieren, wird nie in Toasts, Fehlermeldungen oder `console` ausgegeben. Der Hinweis „Du siehst es nur einmal“ bleibt sichtbar.
5. **Fehlermeldungen** nennen nie den Wert; Servermeldungen werden unverändert angezeigt (Backend bereinigt sie, Plan 1.1.7).
6. **Link-Seiten** (`/link/*`, `/invite/*`): `<meta name="referrer" content="no-referrer">` und `noindex`, Token wird nach dem Laden aus der Adressleiste per `history.replaceState` entfernt, sofern der Server den Token in der Sitzung hält (Rückfrage an Phase 2; **unverifiziert**, ob das Backend das erlaubt).
7. **Tool-Beschreibungen und Namen** der Upstreams sind untrusted: nur als Text rendern (kein `v-html`), Länge begrenzen, keine Links erzeugen.
8. **Canary-Test (E2E):** Ein eindeutiger Secret-Wert wird eingegeben, gespeichert und alle Seiten besucht; danach darf der Wert weder im DOM, noch in Antworten (Mock und echt), noch in `localStorage`/`sessionStorage`/Cookies, noch in der Konsole auftauchen.

## 11. Rollenabhängige Sichtbarkeit

Quelle der Rolle: `useSession()` aus dem Better-Auth-Client (`user.role` aus dem `admin()`-Plugin; Typisierung über das Client-Plugin **unverifiziert**). `useSessionUser()` kapselt Rolle, Sperre und Abmelden.

| Bereich | Nutzer | Admin | Hinweis |
|---|---|---|---|
| Navigation Betrieb, Zugang, Audit, Einstellungen | ja | ja | |
| Navigationsgruppe Admin und `/admin/*` | nein (Weiterleitung `/` + Hinweis) | ja | Server prüft mit `requireAdmin`; UI blendet nur aus |
| Upstreams, Tools, Tokens, Clients | nur eigene | nur eigene | Admin sieht fremde Upstreams nie |
| stdio-Typ im Formular | aktiv nur bei Freigabe, sonst gesperrt mit Grund | aktiv, wenn Instanz und Fähigkeit | Grund aus `capabilities.stdio.reason` |
| Admin-Hinweisbox „Du siehst hier nur Metadaten“ | – | auf allen Admin-Seiten | Spec P0-4 |
| Statistik | eigene Zahlen | eigene Zahlen + Reiter „Instanz“ (aggregiert, Phase 2) | Spec P0-15 |
| Audit | eigene Einträge | eigene + Instanzereignisse (z. B. Nutzer gesperrt, Einstellung geändert) | entschieden 2026-11-04 (Entscheidung 6); Server filtert, UI zeigt nur |
| Nutzer sperren/löschen | – | ja, nicht das eigene Konto, nicht der letzte aktive Admin (Knöpfe deaktiviert, Server erzwingt) | Plan 1.1.10 |
| Consent-Scope `mcpwarden:admin` | Schalter (abwählbar) erst ab Phase 2, wenn der Client ihn anfragt; `mcp:tools` immer an | gleich | Rolle des Nutzers beeinflusst die Vergabe nicht in der UI (entschieden 2026-11-04, Entscheidung 5); Server prüft, ob der Nutzer den Scope erhalten darf |

Regeln: Kein Wissen aus dem Frontend ersetzt eine Serverprüfung; 403-Antworten zeigen eine verständliche Seite statt eines Fehlerdumps. Zustände wechseln bei Rollenänderung erst nach erneutem `get-session` (Refresh bei Fokus). Im Mock-Modus schaltet der `MockBanner` zwischen Admin und Nutzer um und löscht den Datenzustand der Seite.

## 12. Barrierefreiheit (Grundlagen)

Der Entwurf ist bereits darauf ausgelegt (44-px-Ziele, Labels, `aria-label`, Statustext neben Farbe). Verbindliche Grundlagen:

- Semantik: ein `h1` je Seite, Landmarken `nav` (Beschriftung „Hauptnavigation“), `main`, `header`; echte `<table>` mit Kopfzellen `scope`; Listen als `ul`.
- Tastatur: alle Aktionen per Tab, Enter, Leertaste; Dialoge fangen den Fokus (Reka UI), geben ihn beim Schließen zurück; Seitenleiste per Strg/Cmd+B (Doku); Skip-Link.
- Fokus: sichtbarer Ring (Zwei Pixel `--primary`, Abstand 2 px) auf allen Bedienelementen; der Entwurf zeigt keinen, daher Pflicht in Aufgabe 2.
- Reiter: Der Entwurf setzt `role="tablist"` auf reine Link-Leisten (Admin-Bereiche, Audit-Filter, Zeitfenster). Das ist falsch, wenn keine Panels existieren. Umsetzung: Admin-Bereiche = Navigationslinks mit `aria-current`; Detail-Reiter = `Tabs` mit Panels; Zeitfenster und Audit-Kategorien = `ToggleGroup` bzw. `Tabs` mit einem Panel.
- Farbe: Zustand immer Text plus Form (Punkt, Chip, Strichart); Diagramme mit Textalternative (`role="img"` + `aria-label` wie im Entwurf, zusätzlich Tabellenansicht).
- Formulare: sichtbares `Label` (`for`), Hilfetext über `aria-describedby`, Fehler `aria-invalid` + `FieldError`; Pflichtfelder mit Text, nicht nur Stern.
- Ansagen: Toasts und Testergebnisse in `role="status"`, Fehler mit Handlungsbedarf `role="alert"`; Ladezustände mit `aria-busy`.
- Bewegung: Übergänge kurz, bei `prefers-reduced-motion` aus.
- Zoom und Reflow: bis 320 px Breite ohne zweidimensionales Scrollen außer Tabellen; Text skalierbar (rem).
- Kontrast: Werte des Entwurfs gelten (Textfarben `#18181b`, `#3f3f46`, `#52525b` auf Weiß und `#f4f4f5`; Statuspaare); das Ergebnis wird mit axe geprüft, Berechnung der Quotienten nicht von Hand durchgeführt (unverifiziert).
- Sprache: `<html lang="de">`; Fachbegriffe in Monospace bleiben unübersetzt.
- Prüfung: axe-core je Seite in Playwright (Mock), manuelle Tastaturrunde je Seite, Bildschirmleser-Stichprobe für Consent, Token-Link, Tool-Tabelle.

## 13. Mock-Strategie

Ziel: Das Frontend entsteht vor den Backend-Phasen und wechselt je Domäne auf echte Routen, ohne Seitencode zu ändern.

**Aufbau:**

- **Typisierter Client** `app/api/*.ts`: dünne Funktionen über `$fetch` (ofetch) mit den Typen aus `#shared/api-types`; `http.ts` setzt Fehlerabbildung (`ApiError` mit `statusCode`, `code`, `field`, `message`), leitet 401 auf `/login`, wirft bei 403 einen markierten Fehler. Seiten greifen nur über `useApi()`-Composables zu, nie über `$fetch` direkt.
- **MSW-Handler** `mocks/handlers/<domäne>.ts` (aus `msw/http`: `http`, `HttpResponse`), In-Memory-Zustand `mocks/state.ts` mit Seed aus den Entwurfsdaten (`mocks/seed.ts`: 7 Upstreams, 6 Clients, 3 Tokens, 3 Nutzer, 8 Audit-Zeilen, Allowlist mit 7 Einträgen). Zustand wird in `sessionStorage` gehalten und per Konsolenhilfe `__mock.reset()` zurückgesetzt. Handler halten sich an dieselben Regeln wie das Backend (Slug-Regex, Limit 50, 409 bei Kollision, `hasSecret` statt Secret, PAT-Klartext nur in der POST-Antwort, Link nur beim Erzeugen).
- **Auth im Mock:** `/api/auth/sign-in/email`, `sign-up/email`, `sign-out`, `get-session` und die Settings-Endpunkte werden nachgebildet, damit der echte Better-Auth-Client unverändert läuft. Antwortform nach der echten Antwort aus 0a angleichen (**unverifiziert**, Contract-Test in Aufgabe 4 deckt es auf). Rollenwechsel über `localStorage.mockRole`.
- **Szenarien** `mocks/scenarios.ts`: `localStorage.mockScenario` = `default | empty | error | slow | forbidden | huge`. Daraus entstehen Leer-, Fehler-, Lade- und 403-Zustände ohne Codeänderung; der `MockBanner` schaltet sie um.
- **Aktivierung:** `VITE_API_MOCK=all` oder eine Liste (`auth,oauth,me`), gesetzt über `pnpm ui:dev` (Mock, SPA) bzw. nicht gesetzt (`pnpm dev`, echt). In `nuxt.config.ts`: `ssr: !process.env.VITE_API_MOCK`. `plugins/msw.client.ts` startet den Worker nur bei gesetzter Variable (dynamischer Import, damit der Produktions-Build ihn nicht enthält); `onUnhandledFrame: 'bypass'`, sodass nicht gemockte Domänen den echten Server erreichen. Welche Domänen gemockt sind, steht an einer Stelle (`mocks/index.ts`) und im `MockBanner`.
- **Vite-Plugin oder `msw init`:** Aufgabe 4 klärt in einem kurzen Spike, ob `msw/vite` (Doku: liefert den Worker) in Nuxt ohne weiteres einzubinden ist; sonst `public/mockServiceWorker.js` per `npx msw init` (Befehl **unverifiziert** für Version 3).
- **Tests:** dieselben Handler laufen in Vitest über `setupServer` (`msw/node`, Doku: Setup-Datei mit `beforeAll/afterEach/afterAll`).

**Austauschbarkeit absichern (Contract-Tests, `tests/ui/contract`):** Für jede Route steht ein zod-Schema (`satisfies z.ZodType<ResponseTyp>`, damit Schema und Typ nicht auseinanderlaufen). Der Test ruft (1) die Mock-Handler auf und (2) bei gesetztem `CONTRACT_BASE_URL` und Anmelde-Cookie den echten Server (gebautes Artefakt aus dem Backend-Harness). Beide müssen dasselbe Schema bestehen. Damit fällt Drift zwischen Mock und Backend in dem Moment auf, in dem eine Phase fertig wird.

**Umstellung je Phase:** Domäne aus `VITE_API_MOCK` entfernen, Contract-Test gegen den echten Server laufen lassen, E2E-Suite der Seite im Echt-Modus wiederholen (Aufgabe 18). Reihenfolge der Domänen in Abschnitt 15.

## 14. Aufgaben

Reihenfolge ist verbindlich, wo eine Abhängigkeit genannt ist; sonst nach jeder Aufgabe ein grüner Zwischenstand (`pnpm ui:check` = Typecheck + Lint + `ui:test`). Jede Seite wird zuerst gegen den Mock fertig gebaut (inklusive Leer-, Lade-, Fehlerzustand und axe-Prüfung), erst danach auf echte Routen gestellt.

### Aufgabe 1: Gerüst-Check, Abhängigkeiten, Skripte, Grenzen
- Zweck: arbeitsfähiger Zustand auf Branch `feat/frontend`, ohne Konflikte mit den Backend-Agenten.
- Startpunkt: erst nach dem Meilenstein „Gerüst steht“ von Phase 0a (A2: Ende von 0a Task 1). Vorher kein Eingriff in `package.json` und `nuxt.config.ts`.
- Dateien: `package.json` (nur eigene Abhängigkeiten und Skripte `ui:dev`, `ui:test`, `ui:e2e`, `ui:check`), `nuxt.config.ts` (eigene Schlüssel), `.github/workflows/ui.yml`, `tests/ui/vitest.config.ts`.
- Schritte: 1. Voraussetzung prüfen: Nuxt-Gerüst von 0a (Commit `chore: nuxt scaffold`, A2) vorhanden, sonst warten bzw. Rückmeldung. Tailwind und shadcn-vue richtet diese Aufgabe selbst ein. 2. Abhängigkeiten aus Abschnitt 2 exakt pinnen. 3. `nuxt.config.ts`: `ssr: !process.env.VITE_API_MOCK`, Module, `css`, Tailwind-Plugin, `shadcn`, `colorMode`. 4. Skripte anlegen; `ui:dev` setzt `VITE_API_MOCK=all`. 5. CI-Datei `ui.yml` mit Typecheck, Lint, `ui:test`, `ui:e2e` (Playwright gegen `ui:dev`-Build). 6. Verzeichnisse nach Abschnitt 4 anlegen. 7. In `README.md` (nur Abschnitt „Frontend“) Regeln zur Eigentumsgrenze.
- Prüfung: `pnpm ui:dev` zeigt eine leere Seite, `pnpm build` bleibt grün.
- DoD: kein Diff in `server/**`; CI-Job läuft.

### Aufgabe 2: Design-Tokens, Schriften, Basiskomponenten, Formularbibliothek (Spike)
- Zweck: Optik des Entwurfs in Variablen fassen; technische Unsicherheiten früh klären.
- Dateien: `app/assets/css/tailwind.css`, `components.json`, `app/components/ui/*` (Varianten), `app/lib/utils.ts`, `app/lib/zod-schemas.ts`.
- Schritte: 1. Tokens aus Abschnitt 7 als CSS-Variablen unter `:root` (Hex), `@theme inline` für Tailwind, `.dark` mit leeren Platzhaltern. 2. Schriften lokal einbinden, keine Google-Fonts-Links. 3. shadcn-Komponenten aus Abschnitt 8 hinzufügen; `Button` (Varianten `default` = Akzent, `outline`, `destructive-outline`), `Input`, `Select` auf 44 px und `rounded-sm` setzen; Fokusring ergänzen. 4. Sidebar-Variablen (248/64 px) prüfen. 5. **Spike:** vee-validate + zod 4 (`toTypedSchema`); bei Fehlschlag Fallback über Schema-Fehlerliste dokumentieren. 6. **Spike:** Zahlenformat `formatNumber` (Intl-Ausgabe des schmalen Leerzeichens).
- Prüfung: Seite „Styleguide“ (nur im Mock-Modus, Route `/__styleguide`) zeigt Farben, Chips, Typografie, Formularzeilen; Vergleich mit den Boards `Main` und `Consent` per Sichtprüfung.
- DoD: Tokens vollständig; Spike-Ergebnisse als Kommentar in `zod-schemas.ts` und in Abschnitt 2 nachgetragen.

### Aufgabe 3: Vertrag und API-Client
- Zweck: Grenze zum Backend festschreiben.
- Dateien: `shared/api-types.ts`, `app/api/*.ts`, `app/composables/useApi.ts`, `app/lib/labels.ts`.
- Schritte: 1. Typen aus Abgleich Abschnitt 5 anlegen (alle Routen, auch Phase 2/3, mit Kommentar „Phase n“). 2. `http.ts` mit Fehlerabbildung (Abschnitt 13). 3. Modulfunktionen je Domäne. 4. `useApi` mit `useAsyncData(..., { server: false })`, Ladezustand, Fehler, `refresh`. 5. Label-Tabellen (Status, Aufrufstatus, Scopes, Tool-Art) mit Rohwert-Fallback bei unbekanntem Enum. 6. Im README-Abschnitt festhalten: Backend-Agenten prüfen mit `satisfies`.
- Prüfung: Typecheck; Unit-Test `labels` (jeder Enumwert hat Label).
- DoD: Vertrag eingecheckt, Backend-Agenten informiert.

### Aufgabe 4: Mock-Schicht und Contract-Tests
- Zweck: Entwicklung ohne Backend (F2, F3).
- Dateien: `mocks/**`, `app/plugins/msw.client.ts`, `tests/ui/contract/*`.
- Schritte: 1. Spike MSW 3 in Nuxt (Vite-Plugin oder `msw init`); Ergebnis als Kommentar in `msw.client.ts`. 2. State, Seed, Szenarien. 3. Handler je Domäne (Reihenfolge: auth, me, oauth, admin-oauth, upstreams, admin, audit, dashboard, stats, links). 4. Zufällige Verzögerung 150 bis 500 ms, abschaltbar. 5. Contract-Schemas und -Tests (Mock immer, echt optional).
- Prüfung: `pnpm ui:dev` läuft; Anmelden mit Seed-Konto; alle Routen aus Abschnitt 5 liefern Daten; `ui:test` grün; Szenarien erzeugen die Zustände.
- DoD: kein Seed-Secret im Mock (Test); Rolle umschaltbar.

### Aufgabe 5: Layout, Navigation, Guards, Fehlerseiten
- Zweck: Hülle aller Seiten (Abschnitt 6).
- Dateien: `app/app.vue`, `layouts/{default,auth}.vue`, `components/shell/*`, `middleware/{auth.global,admin}.ts`, `composables/{useSessionUser,useSidebarState,useAttentionCount}.ts`, `lib/nav.ts`, `error.vue`.
- Schritte: Sidebar-Aufbau, Eingeklappt-Zustand mit Cookie, Mobil, Nutzermenü, Skip-Link, `PageHeader`, `AdminTabs`, `MockBanner`, Toaster, Guards inkl. `redirect`-Query und Erhalt der OAuth-Query.
- Prüfung: Komponententest Navigation je Rolle; E2E: Einklappen bleibt nach Neuladen; Tastatur Strg+B; 375-px-Ansicht; axe.
- DoD: F5, F7, F8 für die Hülle erfüllt; `DashboardCollapsed` und `Dashboard` ergeben denselben Seitenrahmen.

### Aufgabe 6: Gemeinsame Bausteine
- Zweck: Wiederverwendung statt Einzelbauten.
- Dateien: `components/common/*`.
- Schritte: Bausteine aus Abschnitt 8 mit Props-Typen, Zuständen, Tests; `StatusBadge` kennt alle fünf Health-Werte plus `unknown` und `setup`-Zustände; `SecretField` und `OneTimeSecret` halten Regeln aus Abschnitt 10; `SparkBars` und `Heatmap` mit Textalternative.
- Prüfung: Komponententests (Rendern, Tastatur, Zugänglichkeit mit axe-Matcher), Styleguide-Seite erweitert.
- DoD: jedes Bauteil im Styleguide mit allen Zuständen.

### Aufgabe 7: Auth-Seiten (Login, Registrierung, Einladung, Consent)
- Zweck: Eintritt und OAuth-Zustimmung (P0-2, P0-4). **Echt ab 0a (Login, Registrierung), Phase 1 (Einladung), 0b (Consent).** Diese Seiten sind Frontend-Aufgaben; die Backend-Phasen bauen sie nicht mehr (Entscheidung 1, A3) und liefern nur API und Tests.
- Dateien: `pages/{login,register,consent}.vue`, `pages/invite/[token].vue`, `layouts/auth.vue` (aus Aufgabe 5), `components/access/{ScopeList,ClientWarning,RedirectDisplay}.vue`, `lib/auth-client.ts`.
- Teilaufgaben:
  - **7a Login (`/login`)**: `Field`-Formular E-Mail und Passwort, Fehlertexte (falsche Daten, gesperrter Nutzer), `redirect`-Query, Weiterführung der signierten OAuth-Query unverändert (0b R14), Link „Registrieren“ nur, wenn die Registrierung offen ist (sonst Hinweis „nur mit Einladung“).
  - **7b Registrierung (`/register`)**: Name, E-Mail, Passwort, Bestätigung; bei 403 Meldung „Registrierung nur mit Einladung“ (erster Nutzer wird Admin, danach geschlossen, 0a O1).
  - **7c Einladung annehmen (`/invite/<token>`)**: lädt `GET /api/invites/:token`; gültig → Registrierungsformular, E-Mail vorbelegt und gesperrt, wenn die Einladung an eine Adresse gebunden ist; ungültig, abgelaufen (7 Tage) oder verbraucht → Fehlerseite mit Hinweis, sich beim Admin zu melden; Token nie in Formularfeld, Toast oder Log (Abschnitt 10 Regel 6); nach Erfolg Weiterleitung auf `/`.
  - **7d Consent (`/consent`)** nach `Consent`-Entwurf: Kopf, `ClientWarning` nur bei `allowlisted=false`, Pflicht-Checkbox schaltet „Zugriff erlauben“ frei; bekannter Client ohne Warnung; Fehlerseite bei ungültiger Signatur; Loopback-Zusatzwarnung; Redirect-Host fett; zwei Schalter: `mcp:tools` (immer an, nicht abwählbar) und `mcpwarden:admin` (abwählbar, bis Phase 2 nicht gerendert); Scope-Titel aus Label-Tabelle, Roh-Scope in Monospace; die gewählte Scope-Teilmenge geht an den Server; Ablehnen führt zurück zum Client (`access_denied`).
- Prüfung: E2E im Mock (alle Consent-Varianten, Einladung gültig/gebunden/abgelaufen/verbraucht); gegen echt nach 0a/0b: Anmelden, Registrieren (erster Nutzer), Consent mit Claude Code manuell; nach Phase 1: Einladungslink annehmen.
- DoD: F1 für die vier Boards; F13, F14; Tastatur und axe grün.

### Aufgabe 8: Persönliche Seiten (Einstellungen, Tokens, Clients)
- Zweck: P0-3, Widerruf, Konto. **Echt ab 0b (Tokens, Clients), 0a (Einstellungen).**
- Dateien: `pages/settings/{index,tokens,connections}.vue`, `components/access/{PatTable,ConnectionTable}.vue`.
- Schritte: 1. Tokens: Erzeugen-Dialog (Name), `OneTimeSecret`-Banner nach Erfolg, Tabelle (Name, Anfang `mcpw_pat_` + 4, erstellt, zuletzt benutzt, Status), Widerruf mit `ConfirmDialog`, Leerzustand, Limit-Hinweis. 2. Clients: Tabelle (Client, autorisiert, zuletzt verbunden, Berechtigung als Titel), Widerruf mit Hinweis „wirkt beim nächsten Aufruf“, Leerzustand; Karte „Was Clients sehen“ nur sichtbar, wenn Phase 3 aktiv (Feature-Flag aus `capabilities`). 3. Einstellungen: Profil (Name), Passwort, Web-Sitzungen, Darstellung (nur Seitenleiste eingeklappt als Standard; die Farbschema-Auswahl „System“/„Dunkel“ bleibt bis nach Phase 2 ausgeblendet, Entscheidung 8), kein E-Mail-Wechsel, keine Mail-Benachrichtigungen, keine Selbstlöschung (gestrichen, Entscheidung 3).
- Prüfung: Komponenten- und E2E-Tests im Mock; Canary-Test PAT; nach 0b gegen echt (Isolation: zweiter Mock-/Echtnutzer sieht nichts fremdes).
- DoD: Seiten decken `Tokens`, `Clients`, `Settings` ab, soweit Spec und Plan es tragen.

### Aufgabe 9: Admin Clients (DCR)
- Zweck: P0-2 Policy, Allowlist, Registrierungen. **Echt ab 0b.**
- Dateien: `pages/admin/oauth.vue`, `components/admin/{AllowlistTable,AllowlistDialog,ClientRegistrations}.vue`.
- Schritte: Radiogruppe (Aus / Nur Allowlist / Offen mit Warnung, Standard Offen), Hinweistext „Allowlist ist Komfort und Warnlogik, kein Sicherheitsmerkmal“ (0b Aufgabe 3), Allowlist-Tabelle mit Eintrag-Dialog und Entfernen, Registrierungstabelle (Name, Redirect-URIs, erstellt, zuletzt genutzt, Nutzer, Allowlist-Status, Verfall), Widerruf mit Bestätigung.
- Prüfung: E2E Mock; nach 0b gegen echt (Nicht-Admin erhält die 403-Seite).
- DoD: `AdminClients` vollständig inkl. Leer-/Fehlerzuständen.

### Aufgabe 10: Upstreams (Liste, Anlegen, Bearbeiten, Detail)
- Zweck: P0-5, P0-6, P0-7, P0-14 (Anzeige). **Echt ab Phase 1 (Meilensteine 1.1 und 1.2).**
- Dateien: `pages/upstreams/{index,new}.vue`, `pages/upstreams/[id]/{index,edit}.vue`, `components/upstreams/*`.
- Schritte: 1. Liste: Filter (Suche, Status, Typ; ohne Tags, gestrichen), Statuskarten, Tabelle mit Kürzel, Name, URL/Befehl, `StatusBadge`, Typ, Tools „aktiv / gesamt“, p95 und `SparkBars` nur wenn die API sie liefert (sonst Spalte ausgeblendet), Meldung, Aktionen (testen, bearbeiten); „+ Upstream hinzufügen“; „JSON importieren“ erst Phase 3; „Alle testen“ nicht gebaut (später mit Bestätigung und Rate-Hinweis, Aufgabe 16); keine Gerätenamen. 2. Anlegen/Bearbeiten: Formular nach Abschnitt 9, Hinweis je Anmeldeart, Secret-Feld, `SlugField`, „Anlegen und verbinden“ ruft Anlegen, Secret, Test nacheinander und zeigt `TestResult` (Tools oder Fehlertext). 3. Detail: Kopf mit Aktionen (Testen, Deaktivieren, Bearbeiten, Löschen mit Bestätigung); Tabs Übersicht (Details, Warnbox aus `statusReason`, Kennzahlen soweit geliefert), Tools (`ToolTable`: Name, Beschreibung als Text, Art-Badge, Schalter wirkt sofort mit optimistischer Anzeige und Rücknahme bei Fehler), Auth (Zustand „Gesetzt“, „Ersetzen“, bei OAuth Ablauf und Knopf „Neu verbinden“ ab Phase 2); linke Liste der Upstreams mit Suche (Entwurf) als umschaltbare Seitenspalte. 4. Zustände: leer („Noch kein Upstream“ mit Schritten), Laden, Fehler, `unknown`, `setup`.
- Prüfung: E2E Mock (Anlegen ≤ 2 Minuten, Abnahme 7 der Spec manuell stoppen), Canary-Test, Fremd-ID liefert 404-Seite; gegen echt nach 1.1.8 und 1.2.2.
- DoD: `Main`, `UpstreamNeu`, `Detail` (ohne Kurven) umgesetzt; Tool-Änderung ohne Neuladen sichtbar.

### Aufgabe 11: Admin Nutzer, Einladungen, Instanz
- Zweck: P0-4 und Admin-Einstellungen. **Echt ab Phase 1 (1.1.9, 1.1.10, 1.3.5).**
- Dateien: `pages/admin/{users,settings}.vue`, `components/admin/{UserTable,InviteDialog,LimitsDialog,SsrfList}.vue`.
- Schritte: 1. Nutzertabelle (Nutzer, Rolle, Upstreams „x / Limit“, letzte Aktivität, stdio-Checkbox, Aktionen Sperren/Entsperren, Limits, Löschen mit doppelter Bestätigung inkl. Folgenliste), Zustand gesperrt, Schutz für eigenes Konto und letzten Admin. 2. Einladungen: Erzeugen (optional E-Mail-Bindung, Gültigkeit fest 7 Tage), Ergebnisbanner `OneTimeSecret` mit Link `/invite/<token>`, Liste offener Einladungen mit Ablauf und Widerruf. 3. Instanz: Schalter `stdio.enabled`, SSRF-Ausnahmeliste (Tabelle, kein Boolean), Registrierung nur per Einladung (Token-Link, Entscheidung 2; kein separater „Allowlist“-Schalter); Hinweis zu Wirkung (stdio „führt Code auf dem Host aus“).
- Prüfung: E2E Mock; nach Phase 1 gegen echt, Nicht-Admin 403.
- DoD: `Admin`, `AdminInstanz` vollständig inklusive der im Abgleich ergänzten Zustände.

### Aufgabe 12: stdio im Formular, Sperrgründe, Freigabeseite
- Zweck: P0-5 Freigabe, P0-12 Entwurf. **Echt ab 1.3 (Formular, Gründe), Phase 2 (Freigabeseite).**
- Dateien: `components/upstreams/{StdioFields,SetupHint}.vue`, `pages/upstreams/[id]/approve.vue`.
- Schritte: Formularfelder nach Abschnitt 9, Sperrgründe aus `capabilities`, Freigabeseite nach `StdioFreigabe` (Befehl in Monospace, Pfad vom Server, Herkunft, Prüfliste aus API-Feldern statt fest, Verwerfen, „Freigeben“; Text „startet beim ersten Aufruf“), Anzeige „wartet auf Freigabe“ in Liste und Detail.
- Prüfung: Mock-Szenarien für jede Sperrursache; E2E.
- DoD: alle vier Sperrgründe sichtbar; Board `StdioFreigabe` umgesetzt.

### Aufgabe 13: Dashboard und Audit
- Zweck: Überblick (Entscheidung 4) und P0-12/P0-14 Audit. **Echt ab Phase 1 (Clients, Aufmerksamkeit, Audit lesen; Routen `/api/dashboard` ohne KPIs und `/api/audit`, E11, entschieden 2026-11-04), KPIs und Diagramm Phase 2.**
- Dateien: `pages/index.vue`, `pages/audit.vue`, `components/common/KpiCard.vue` (Nutzung).
- Schritte: 1. Dashboard: Leerzustand mit MCP-URL und Einrichtungsbefehl; Kennzahlen (nur wenn geliefert); Tabelle „Verbundene Clients“ mit „Aktiv/Inaktiv“ (letzter Aufruf < 5 min), „Zuletzt aktiv“, Aufrufe/min, Kontextgröße (ohne Gerätenamen, gestrichen); Widerruf (OAuth: Verbindung, PAT: Token); Karte „Braucht Aufmerksamkeit“ mit Link zum Detail und Neu-verbinden-Knopf bei `auth_expired`; Diagramm Aufrufe/min (Phase 2). 2. Audit: Kategorien als Umschalter (Kategorie „Anmeldung“ nur, wenn die API sie liefert), Tabelle mit Zeit, Client, Aktion, Ziel, Ergebnis; Nutzer sehen eigene Einträge, Admin zusätzlich Instanzereignisse (Server filtert, Entscheidung 6); Cursor-Paging („Mehr laden“); Leerzustand.
- Prüfung: E2E Mock inklusive „nichts zu tun“; axe.
- DoD: `Dashboard`, `DashboardCollapsed`, `Audit` umgesetzt; Texte folgen Abgleich W4, W7.

### Aufgabe 14: Statistik und Verlaufskurven
- Zweck: P0-15 Anzeige. **Echt ab Phase 2.**
- Dateien: `pages/stats.vue`, `components/stats/*`, Erweiterung von `pages/upstreams/[id]/index.vue`.
- Schritte: `shadcn-vue add chart`; Seite nach `Statistik` (Fenster 5 min/1 h/24 h/7 d, Upstream- und Tool-Filter, fünf Kennzahlen, Aufrufe/Stunde, Ergebnis der Aufrufe, Perzentiltabelle p5/p50/p75/p95/p99 + Overhead p95); Detail: Perzentil-Tabelle mit allen fünf Werten, `LatencyChart`, Fehler nach Art, Verfügbarkeit und Heatmap nur bei vorhandener `health-history` (sonst Karten nicht gerendert, Entscheidung 7); Admin-Reiter „Instanz“.
- Prüfung: Komponententests mit festen Daten (Achsenskalen!), E2E Mock, Textalternativen.
- DoD: `Statistik` und Kurven des `Detail` umgesetzt; Y-Achsen stimmen mit den Werten (Abgleich Punkt 27).

### Aufgabe 15: Link-Seiten, REST-Editor, Upstream-OAuth
- Zweck: P0-12, P0-8, P0-13. **Echt ab Phase 2.**
- Dateien: `pages/link/{[token],done}.vue`, `components/upstreams/RestFields.vue`, Anpassung `SetupHint`.
- Schritte: Token-/Header-Seite nach `AuthLink` (mit Fehlerzuständen: abgelaufen, verbraucht, fremder Nutzer, Test fehlgeschlagen), OAuth-Rückkehr (`connected`, `unsupported`, `error`), REST-Editor nach Abschnitt 9, Anmeldeart OAuth im Formular, Knopf „Neu verbinden“, Scopes im Auth-Tab; Consent: Schalter `mcpwarden:admin` einblenden (Entscheidung 5).
- Prüfung: E2E Mock, Canary-Test Link-Token, Referrer- und `noindex`-Header geprüft.
- DoD: `AuthLink` vollständig; REST-Tools anlegbar im Mock.

### Aufgabe 16: Phase-3-Funktionen
- Zweck: Tool-Modus, Import/Export, Vorlagen; außerdem die auf später verschobenen Elemente (Entscheidungen 7 und 8). **Echt ab Phase 3.**
- Dateien: `pages/settings/connections.vue` (Tool-Modus), `components/upstreams/ImportDialog.vue`.
- Schritte: Tool-Modus-Auswahl mit Wirkungstext; Import als Dialog (Vorschau, Fehler je Eintrag, nie Secrets), Export ohne Secrets; Vorlagenliste; Schalter „Aufrufe“-Reiter, sobald der Aufruf-Log existiert. Später und nicht Teil der Abnahme von Phase 1 und 2: „Alle testen“ in der Upstream-Liste mit Bestätigungsdialog und Rate-Hinweis (Test zählt gegen Rate-Limit und Breaker); Dunkelmodus nach Phase 2 (Werte für `.dark` ergänzen, Auswahl System/Hell/Dunkel in den Einstellungen einblenden, axe-Kontrastprüfung wiederholen).
- Prüfung: E2E Mock.
- DoD: `Clients` (Tool-Modus) und Import abgedeckt; „Alle testen“ und Dunkelmodus nur, wenn zeitlich eingeplant.

### Aufgabe 17: Härtung (Barrierefreiheit, Responsive, Leistung)
- Zweck: F6, F7, F10 flächendeckend.
- Schritte: axe über alle Routen und Zustände, manuelle Tastaturrunde, Bildschirmleser-Stichprobe, Breiten 320/375/768/1440, Fokusreihenfolge, Zahlen- und Zeitformate, Ladezeit (keine Blockade durch Charts: `chart` per dynamischem Import), Bundle-Größe, Entfernen des Mock-Codes aus dem Produktions-Build (Test: `pnpm ui:check-build` prüft Dateinamen und Inhalt von `.output` auf Worker-Datei, `INTEGRITY_CHECKSUM`, `startMock`, `setupWorker`, Seed-Code; in CI nach `pnpm build`; Mock-Builds schreiben nach `.output-mock`).
- Prüfung: `ui:e2e` grün, Bericht im PR.
- DoD: keine axe-Verstöße „serious“/„critical“; Checkliste Abschnitt 12 abgehakt.

### Aufgabe 18: Umstellung auf echte Routen und Abnahme (je Phase wiederholt)
- Zweck: F9.
- Schritte: je Phase die Domänen aus Abschnitt 15 aus `VITE_API_MOCK` nehmen, Contract-Tests gegen das gebaute Backend, E2E-Suite im Echt-Modus (Harness-Server aus `tests/integration`, **nur lesend genutzt**), Abweichungen als Änderung am Vertrag oder als Fehler beim Backend-Agenten melden (nicht selbst in `server/` beheben), Abschnitt 3 dieses Plans mit realen Befunden aktualisieren.
- DoD: für die Phase alle zugehörigen Seiten laufen ohne Mock; Protokoll in `docs/manual-tests/frontend-<phase>.md`.

## 15. Reihenfolge und Echtdaten-Fahrplan

| Zeitpunkt | Frontend-Arbeit | Läuft gegen echte Daten |
|---|---|---|
| Vorarbeit (vor „Gerüst steht“) | nur Vertrag `shared/api-types.ts`, Mock-Entwurf, Labels; kein Eingriff in `package.json`/`nuxt.config.ts` | nichts |
| sofort nach Meilenstein „Gerüst steht“ (Ende 0a Task 1, A2) | Aufgaben 1 bis 6; Seiten der Aufgaben 7 bis 16 gegen Mock, in dieser Reihenfolge | nichts |
| nach 0a (Aufgabe 8 und 9 des Backends) | Aufgabe 18 für `auth`; Aufgabe 7a/7b (Login, Registrierung; Backend liefert nur API), Teil von Aufgabe 8 (Einstellungen: Name, Passwort, Sitzungen) | `/login`, `/register`, Sitzung, Rolle, `/settings`, Shell mit Navigation nach Rolle |
| nach 0b | Aufgabe 18 für `oauth`, `me`, `admin-oauth`; Aufgaben 7 (Consent), 8, 9 | `/consent`, `/settings/tokens`, `/settings/connections`, `/admin/oauth` |
| nach Phase 1, Meilenstein 1.1 | Aufgabe 10 (CRUD, Test, Secret), Aufgabe 11 (inkl. Einladungen als Token-Link); Aufgabe 7c (Einladung annehmen); Aufgabe 18 für `upstreams`, `admin` | `/upstreams`, `/upstreams/new`, `/upstreams/[id]/edit`, `/admin/users`, `/admin/settings`, `/invite/<token>` |
| nach Phase 1, Meilenstein 1.2 (Erwartung: Routen `/api/dashboard` ohne KPIs und `/api/audit` sind Teil von Phase 1, E11; entschieden 2026-11-04) | Tool-Schalter, Status, Statuskarten, Limit-Treffer; Aufgabe 13 (Dashboard: Clients-Tabelle und Aufmerksamkeit ohne KPIs; Audit lesen mit Nutzer-/Admin-Sicht) | Tools-Tab, Statusanzeige, `/` (Clients, Aufmerksamkeit), `/audit` |
| nach 1.3 | Aufgabe 12 (stdio-Formular, Sperrgründe) | stdio im Formular |
| nach Phase 2 | Aufgaben 13 (KPIs, Diagramm), 14 (Verfügbarkeit und Heatmap nur mit `health-history`), 15 (Consent-Schalter `mcpwarden:admin` sichtbar); danach Dunkelmodus (Aufgabe 16) | `/stats`, Kurven, `/link/*`, Freigabeseite, REST-Editor, OAuth-Upstream, Admin-Scope im Consent |
| nach Phase 3 | Aufgabe 16 (Tool-Modus, Import; „Alle testen“ mit Bestätigung und Rate-Hinweis) | Tool-Modus, Import |

Parallelität: Aufgaben 7 bis 9 hängen nur an 3 bis 6; 10 und 11 sind danach unabhängig; 13 bis 16 sind unabhängig, bis auf die Nutzung der Bausteine aus 6.

## 16. Teststrategie

- **Unit** (Vitest): `labels`, `formatNumber`, `RelativeTime`, zod-Schemas (Slug-Tabelle mit Grenzfällen: 32 Zeichen, `__`, Großbuchstaben, Bindestrich am Anfang), `nav` je Rolle.
- **Komponente** (Vitest + `@vue/test-utils`, MSW `setupServer`): `StatusBadge`, `SecretField`, `OneTimeSecret`, `ConfirmDialog`, `UpstreamForm` (alle Anmeldearten), `ToolTable` (optimistischer Schalter, Rücknahme), `ClientWarning`.
- **Contract** (Abschnitt 13): Mock immer, echt bei gesetztem `CONTRACT_BASE_URL`.
- **E2E** (Playwright gegen `ui:dev`-Build, Mock): Hauptpfade je Board, alle Szenarien (`empty`, `error`, `forbidden`, `slow`), Rollenwechsel, Einklappen, 375 px, Canary-Secret-Test, axe je Seite. Nach jeder Phase dieselbe Suite im Echt-Modus gegen das gebaute Backend (Aufgabe 18).
- **Sichtvergleich:** Screenshots der Seiten bei 1440 px neben den Boards (manuell, keine Pixelgleichheit gefordert); Abweichungen werden im PR begründet.
- **Nicht getestet im Frontend:** Autorisierungslogik des Backends, Mandantentrennung (liegt in den Isolationstests der Backend-Phasen); das Frontend prüft nur, dass es bei 403/404 sauber reagiert.

## 17. Risiken

| Risiko | Wirkung | Gegenmaßnahme |
|---|---|---|
| R1 Drift zwischen Mock und Backend | Seiten brechen bei der Umstellung | gemeinsame Typen, Contract-Tests, Vertragsänderung nur mit Mock-Anpassung im selben Commit |
| R2 Zwei Seitenfamilien (Backend-Pläne bauen noch Vue-Dateien, obwohl das Frontend alle `app/**`-Dateien übernimmt, entschieden 2026-11-04) | doppelte Arbeit, Stilbruch, Merge-Konflikte in `app/**` | Backend-Pläne streichen ihre Vue-Aufgaben (0a Task 9, 0b Aufgaben 3 bis 5, Phase 1 Aufgaben 1.1.8 bis 1.1.10, 1.3.5; nur API, Tests, Vertragsbeiträge bleiben); bis dahin Backend-Agenten bitten, `app/**` nicht zu erzeugen; Login und Registrierung baut das Frontend (Aufgabe 7) |
| R3 MSW 3 im Nuxt-Dev nicht ohne Weiteres einzubinden | kein Mock | Spike Aufgabe 4; Fallback: eigener kleiner Mock-Server (Node, `h3`) mit denselben Handlern und Proxy über `routeRules` (Doku: `routeRules` existiert, als experimentell markiert) |
| R4 Better-Auth-Antwortformen im Mock stimmen nicht | Login-Fluss weicht ab | Mock-Auth früh gegen echtes 0a-Artefakt vergleichen; Contract-Test |
| R5 Sidebar-Details (Persistenz, Icon-Breite, Mobil) unverifiziert | Abweichung vom Entwurf | Aufgabe 5 prüft im Browser; eigene Persistenz per Cookie |
| R6 vee-validate/zod-4-Kompatibilität | Formulare ohne Typprüfung | Spike Aufgabe 2, Fallback über Standard-Schema-Fehlerliste |
| R7 Entwurf deckt viele Zustände nicht ab (leer, Fehler, Laden, Dialoge, Variante stdio/REST) | uneinheitliche Eigenbauten | Bausteine aus Aufgabe 6 sind die einzige Quelle; Texte im Glossar; Review mit dem Entwurfsautor |
| R8 Tabellen und Diagramme mit Daten, die kein Plan liefert (Verfügbarkeit, Heatmap, Geräte, Tags) | tote Oberfläche | Spalten/Karten erscheinen nur, wenn die API das Feld liefert; sonst ausgeblendet; Tags und Gerätenamen sind gestrichen, Verfügbarkeit und Heatmap nur mit `health-history` (Entscheidung 7) |
| R9 XSS durch Upstream-Texte, Client-Namen | Datenabfluss | nur Text-Interpolation, kein `v-html`, Längen kürzen, Lint-Regel `vue/no-v-html` |
| R10 Secret landet über Devtools, Fehlerberichte oder Logs im Browser | Offenlegung | Regeln Abschnitt 10, Canary-Test, kein Fehlerreporting mit Formularzustand |
| R11 SSR-Cookie-Weitergabe und Hydration-Fehler | flackernde Seiten | Datenabruf nur Client (A5), Auth-Seiten SSR nur mit `useSession(useFetch)` |
| R12 Polling erzeugt Last (Auto-Refresh, viele Karten) | langsames Gateway | Standard „aus“ bzw. 30 s, Pause bei verstecktem Tab, gebündelte Routen statt vieler Einzelaufrufe |
| R13 Barrierefreiheit leidet unter Entwurf (Rollen `tablist`, `aria-pressed`, nur CSS-Grid-Tabellen) | Verstöße | Abschnitte 8, 9, 12 setzen die Gegenmaßnahmen um; axe in CI |
| R14 Mock-Code gelangt in den Produktions-Build | Fehlverhalten, Datenleck der Seed-Daten | dynamischer Import hinter Variable, Test auf Build-Ausgabe (Aufgabe 17) |
| R15 Gemeinsame Dateien (`package.json`, `nuxt.config.ts`) erzeugen Merge-Konflikte | Reibung | eigene Schlüssel, kleine Commits, Reihenfolge 0a, 0b, Phase 1 einhalten; Start erst nach „Gerüst steht“ (A2), vorher keine Änderung an beiden Dateien |
| R16 Phase 1 liefert `/api/dashboard` und `/api/audit` noch nicht (Plan 1 schiebt beides nach Phase 2, Entscheidung 4 verlangt sie in Phase 1) | Dashboard und Audit bleiben bis Phase 2 im Mock | Wunsch E11 an den Phase-1-Agenten; solange die Route fehlt, bleibt die Domäne `dashboard`/`audit` in `VITE_API_MOCK` und Fahrplan-Zeile verschiebt sich |
| R17 Einladungsmodell: Plan 1 kennt E-Mail-Allowlist ohne Token, entschieden ist Token-Link (Entscheidung 2) | `/invite/<token>` hat kein Backend, Admin-Seite passt nicht | E13 an den Phase-1-Agenten; Mock-Handler folgen dem Token-Modell, Contract-Test zeigt die Abweichung |
| R18 Consent mit Scope-Teilmenge (Entscheidung 5) wird vom Better-Auth-Consent evtl. nicht unterstützt (unverifiziert) | Admin-Schalter wirkungslos oder Fehler | Schalter erst ab Phase 2 einbauen; vorher mit 0b-Agent klären, ob die Zustimmung eine Scope-Liste annimmt |

## 18. Unverifiziert (Sammlung)

Nicht gegen offizielle Quellen bestätigt: Cookie- oder Speicherpersistenz, `--sidebar-width-icon` und Mobilverhalten der shadcn-vue-Sidebar; Ableitungsfaktoren von `--radius` im erzeugten Build; welches Icon-Paket `shadcn-vue init` 2.9.0 wählt (`lucide-vue-next` oder `@lucide/vue`); Importpfade von `@fontsource-variable/*`; Kompatibilität von `@vee-validate/zod` 4.15.1 mit zod 4.6.7; API-Namen von `@vueuse/core` 15 (`useIntervalFn`, `useDocumentVisibility`, `useClipboard`); Browser-Setup von MSW 3 in Nuxt, Befehl `msw init` in Version 3, Vite-Plugin `msw/vite`; Antwortformen und Funktionsnamen der Better-Auth-Sitzungsendpunkte (`update-user`, `change-password`, `list-sessions`, `revoke-session`) und die Typisierung von `user.role` im Vue-Client; `history.replaceState`-Verhalten für Link-Token bei laufender Sitzung; Ableitung der Akzent-Tönung per `color-mix`; Kontrastquotienten der Entwurfsfarben; Muster der Allowlist (Claude-Web-Callback, Cursor, Zed); Intl-Ausgabe des Tausendertrenners; ob der Better-Auth-Consent eine Teilmenge der Scopes annimmt (Entscheidung 5); ob `phase-0a.md` den Meilenstein „Gerüst steht“ mit Task 1 und 2 deckt (A2, Erwartung, nicht dokumentiert); ob Phase 1 `/api/dashboard`, `/api/audit` und das Token-Einladungsmodell tatsächlich aufnimmt (E11, E13).
