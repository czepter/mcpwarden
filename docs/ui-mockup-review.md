# UI-Mockup-Review: Umsetzung gegen Entwurf

Stand: 2026-11-05 · Branch `fix/ui-mockup-parity` (von `feat/integration`) · Entwurf: Claude-Artefakt `EXj4fJ9FsvkUjZ3o5hVEcM` (Version `1793857819-9d47`, 16 Boards) · Maßgeblich bei Abweichungen: `docs/ui-abgleich.md` und `docs/spec.md` v0.6.

## Vorgehen und Grenzen

- Die Boards (`*.dc.html`) laufen im Original in der Laufzeit des Artefakt-Typs, die für die Prüfung nicht verfügbar war. Gerendert wurde mit einem kleinen eigenen Renderer (`sc-for`, `sc-if`, `{{…}}`, Eingabe des `renderVals`-Skripts), Inter und JetBrains Mono aus `@fontsource-variable` wie in der App. Die Seitenleisten-Logik wurde einmal nachgebaut und in alle Boards eingesetzt; `DashboardCollapsed` entspricht `Dashboard` mit `collapsed=true` und wurde so gerendert.
- Die Umsetzung lief gegen den MSW-Mock-Build (`pnpm ui:build`, Seed-Daten, Rolle Admin) in Chromium; Desktop 1440 px (Faktor 1) und Mobil 390 px (Faktor 2). 1280 px wurde über die Playwright-Tests geprüft (Standardfenster der E2E-Tests), nicht als Bildpaar abgelegt.
- Bildpaare liegen unter `docs/ui-review/<seite>-{mockup,impl,impl-after}.png` (`impl` = vorher, `impl-after` = nach den Korrekturen), Mobil als `<seite>-m-…`. Die Bilder sind auf 48 Farben quantisiert und bei sehr langen Seiten oben beschnitten (Desktop 2400 px, Mobil 3200 px). Die Mock-Leiste „Mock-Modus“ oben in `impl`/`impl-after` ist Teil des Mock-Builds und kein Befund.
- Der Entwurf zeigt keine Leer-, Lade- und Fehlerzustände (Abgleich Abschnitt 1). Die Umsetzung hat sie; Beispiele: `dashboard-empty`, `dashboard-error`, `upstreams-empty`, `upstreams-error`, `audit-empty`, `tokens-empty`, `stats-error`, `login` (jeweils `-impl-after.png`). Ein Vergleich ist dafür nicht möglich.
- Für Login, Registrierung, Einladung annehmen, Passwort-Reset, `/link/done` gibt es keinen Entwurf („kein Entwurf“ im Abgleich). Sie wurden nicht verglichen.
- Nicht gemessen: Pixelabstände je Element bis ins Detail (die Maße des Entwurfs stimmen in der Stichprobe: h1 20 px/600, Karten Radius 10, Eingaben 44 px, Seitenleiste 248/64 px), Dunkelmodus (Phase 2), Animationen und Hover-Zustände, Tastaturführung (deckt `ui:e2e` ab).

## Bewusst weggelassen laut ui-abgleich.md (nicht angleichen)

Tags und Gerätenamen (Entscheidung 7); „Alle testen“ bis zur Bestätigungsvariante (7); Dunkelmodus und „System“ (8); Admin-Scope im Consent bis Phase 2 (5); „online/verbunden seit/Sitzung offen“ → Aktiv/Inaktiv, „Zuletzt aktiv“ (W7); E-Mail ändern, Benachrichtigungsmails, Konto löschen (3); KPIs, Diagramme, Verfügbarkeit, Heatmap, Latenz-Reihen, Fehler nach Art bis Phase 2 (4, 7); Reiter „Aufrufe“ und „Anmeldung“ (kein Datenmodell); Meta-Tool-Modus in Clients und JSON-Import (Phase 3); REST und OAuth als Upstream-Typ/Anmeldung in Phase 1; Statuslabels In Ordnung/Eingeschränkt (W1); Scope-Namen `mcp:tools` (W2); Einladungs-Link mit Allowlist-Schalter entfällt (2); Pfad `/data/stdio/…` vom Server (W14); Mobile Off-Canvas statt waagerechter Leiste ist im Plan (`frontend.md`, Abschnitt Mobil) festgelegt und dort zur Bestätigung vorgemerkt.

## Zusammenfassung

| Seite | fix | bewusst | Entscheidung nötig |
|---|---:|---:|---:|
| Dashboard (+ eingeklappt) | 1 | 5 | 1 |
| Upstreams (Liste) | 3 | 4 | 2 |
| Upstream-Detail | 2 | 4 | 3 |
| Upstream hinzufügen | 2 | 4 | 0 |
| stdio-Freigabe | 0 | 3 | 1 |
| Auth-Link: Token eingeben | 1 | 2 | 0 |
| OAuth-Zustimmung | 0 | 3 | 0 |
| Statistik | 4 | 2 | 1 |
| Clients | 1 | 2 | 0 |
| Personal Access Tokens | 2 | 0 | 0 |
| Audit-Log | 3 | 1 | 0 |
| Admin: Nutzer und Einladungen | 1 | 2 | 1 |
| Admin: Clients (DCR) | 2 | 1 | 1 |
| Admin: Instanz | 0 | 1 | 0 |
| Einstellungen | 2 | 2 | 1 |
| **Summe** | **24** | **36** | **11** |

Querschnitt (Hülle aller Seiten): Logo, Gruppen, Badge „3“, Breiten 248/64 px, Nutzerblock, Einklappen, Brotkrumen und Überschriften entsprechen dem Entwurf (kein Befund). Die Aktionsknöpfe (D5) und die Reiter (T6, AU3) sind Querschnittsbefunde und unter den Seiten gezählt, auf denen sie auffielen. Alle Hex-Werte in `app/**` außerhalb von `tailwind.css` sind auf Design-Tokens umgestellt (`--warn-*`, `--ok-*`, `--err-*`, `--st-*`); `tailwind.css` ist die einzige Quelle.

Prüfung der Zielgröße (44 px) im Hauptbereich nach den Korrekturen: übrig sind Radios 16 px und Schalter 32×18 px innerhalb ihrer 44 px hohen Beschriftungszeile, Brotkrumen-Links und Verweise im Fließtext (WCAG 2.2 AA erfüllt), sowie SE5. axe (WCAG 2a/2aa, serious/critical) ist auf allen Seiten grün (bestehender Test `axe je Seite`). Kein horizontales Seiten-Scrollen bei 390 px auf allen 16 geprüften Routen.

## Befunde je Seite

### Dashboard (+ eingeklappt)

Entwurf: `Dashboard.dc.html, DashboardCollapsed.dc.html` · Route: `/`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![dashboard Entwurf](ui-review/dashboard-mockup.png) | ![dashboard vorher](ui-review/dashboard-impl.png) | ![dashboard nachher](ui-review/dashboard-impl-after.png) |
| ![dashboard mobil Entwurf](ui-review/dashboard-m-mockup.png) | ![dashboard mobil vorher](ui-review/dashboard-m-impl.png) | ![dashboard mobil nachher](ui-review/dashboard-m-impl-after.png) |
| ![eingeklappt Entwurf](ui-review/dashboard-collapsed-mockup.png) | ![eingeklappt vorher](ui-review/dashboard-collapsed-impl.png) | ![eingeklappt nachher](ui-review/dashboard-collapsed-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| D1 | Komponenten | Kennzahlenzeile (Clients online, Aufrufe/min, Erfolgsquote, Overhead) und Diagramm „Aufrufe pro Minute“ fehlen | bewusst (ui-abgleich) | Entscheidung 4: KPIs und Diagramm erst mit Phase 2 |
| D2 | Komponenten | Zeitfenster „Letzte Stunde“ im Kopf fehlt | bewusst (ui-abgleich) | hängt an den KPIs (Phase 2) |
| D3 | Copy | Status „Online/Inaktiv“, „verbunden seit“, „Sitzung offen“ ersetzt durch „Aktiv/Inaktiv“ und Spalte „Zuletzt aktiv“ | bewusst (ui-abgleich) | W7 |
| D4 | Copy | Gerätenamen („MacBook Pro“) fehlen, Zeile zeigt Redirect-Host | bewusst (ui-abgleich) | Entscheidung 7 |
| D5 | Komponenten | „Widerrufen“ als Textlink ohne Rahmen statt umrandeter 44-px-Schaltfläche (gleiches Muster auf Clients, Tokens, Admin) | fix | behoben (ee12262) |
| D6 | Layout | „Braucht Aufmerksamkeit“ steht unter der Tabelle, im Entwurf als Seitenspalte rechts daneben | Entscheidung nötig | offen: mit KPI-Zeile und Diagramm (Phase 2) sinnvoll, vorher ohne Nutzen |
| D7 | Komponenten | Zusatz „Neu verbinden“ je Zeile der Aufmerksamkeitskarte (Entwurf nur Link) | bewusst (ui-abgleich) | Spec P0-13, Abgleich Abschnitt 2 |

### Upstreams (Liste)

Entwurf: `Main.dc.html` · Route: `/upstreams`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![upstreams Entwurf](ui-review/upstreams-mockup.png) | ![upstreams vorher](ui-review/upstreams-impl.png) | ![upstreams nachher](ui-review/upstreams-impl-after.png) |
| ![upstreams mobil Entwurf](ui-review/upstreams-m-mockup.png) | ![upstreams mobil vorher](ui-review/upstreams-m-impl.png) | ![upstreams mobil nachher](ui-review/upstreams-m-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| U1 | Komponenten | Filter „Tags“ fehlt | bewusst (ui-abgleich) | Entscheidung 7 |
| U2 | Komponenten | „Alle testen“ fehlt | bewusst (ui-abgleich) | Entscheidung 7: später mit Bestätigung und Rate-Hinweis |
| U3 | Komponenten | „JSON importieren“ fehlt | bewusst (ui-abgleich) | Phase 3 |
| U4 | Komponenten | Zeitfenster „Letzte 7 Tage“ im Kopf fehlt | Entscheidung nötig | Wirkung auf Liste ungeklärt (Abgleich Punkt 8) |
| U5 | Layout | Bei 1440 px war die Tabelle 1264 px breit bei 1126 px Platz: die Aktionsspalte (testen, bearbeiten) lag unsichtbar hinter dem Rand | fix | behoben (ab71269), Test mockup-parity |
| U6 | Copy | Zählzeile „7 Upstreams“ über der Tabelle fehlte | fix | behoben (ab71269) |
| U7 | Komponenten | Seitenfuß „Zeige 1–7 von 7 · 10 pro Seite“: Paging fehlt | Entscheidung nötig | offen: bei 50 Upstreams (Limit) ist Paging verzichtbar |
| U8 | Copy | Statuslabels „In Ordnung/Eingeschränkt“ statt „Healthy/Degraded“; Typ „HTTP“ statt „http“; Typ „rest“ fehlt | bewusst (ui-abgleich) | W1, Phase 1 |
| U9 | A11y | Name-Link der Zeile nur 36 px hoch | fix | behoben (ab71269) |

### Upstream-Detail

Entwurf: `Detail.dc.html` · Route: `/upstreams/up_4`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![upstream-detail Entwurf](ui-review/upstream-detail-mockup.png) | ![upstream-detail vorher](ui-review/upstream-detail-impl.png) | ![upstream-detail nachher](ui-review/upstream-detail-impl-after.png) |
| ![upstream-detail mobil Entwurf](ui-review/upstream-detail-m-mockup.png) | ![upstream-detail mobil vorher](ui-review/upstream-detail-m-impl.png) | ![upstream-detail mobil nachher](ui-review/upstream-detail-m-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| T1 | Komponenten | Upstream-Liste mit 24 Balken links neben dem Detail fehlt | Entscheidung nötig | offen: Navigation Detail zu Detail; Balken brauchen Phase 2 |
| T2 | Komponenten | Kennzahlen p50, Overhead, Fehlerquote, Aufrufe/min; Latenz-Chart; „Fehler nach Art“; Spalten Fehler/p95 je Tool | bewusst (ui-abgleich) | Phase 2 (Abgleich Nr. 14) |
| T3 | Komponenten | „Status, letzte 24 Stunden“, Verfügbarkeit und Heatmap fehlen | bewusst (ui-abgleich) | Entscheidung 7: nur mit `health-history` aus Phase 2 |
| T4 | Komponenten | Reiter „Aufrufe“ fehlt | bewusst (ui-abgleich) | P1 Aufruf-Log, nicht gespeichert |
| T5 | Copy | Warnbox zeigt `statusReason` des Servers, nicht den festen Basislinientext | bewusst (ui-abgleich) | W10 |
| T6 | Komponenten | Reiter als Pille mit 40 px statt Unterstreichung in der Akzentfarbe mit 44 px | fix | behoben (ab71269), Test mockup-parity |
| T7 | Layout | Statuschip steht rechts im Seitenkopf, im Entwurf neben der Überschrift im Inhalt | Entscheidung nötig | offen, rein optisch |
| T8 | Layout | Tools-Tabelle liegt im Reiter „Tools“, im Entwurf unter der Übersicht | Entscheidung nötig | offen: Entwurf nennt Reiter „Tools“ nicht ausgearbeitet |
| T9 | Daten | Mock-Seed: linear zeigt „Anmeldung Keine“ mit Badge „Gesetzt“ (Secret ohne Auth-Art) | fix | behoben (mocks/seed.ts) |

### Upstream hinzufügen

Entwurf: `UpstreamNeu.dc.html` · Route: `/upstreams/new`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![upstream-new Entwurf](ui-review/upstream-new-mockup.png) | ![upstream-new vorher](ui-review/upstream-new-impl.png) | ![upstream-new nachher](ui-review/upstream-new-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| N1 | Layout | Formular liegt in der App-Hülle mit Brotkrumen statt als freistehende Karte | bewusst (ui-abgleich) | frontend.md Routenkarte, Seite gehört zur Navigation |
| N2 | Komponenten | Typ REST und Anmeldung OAuth fehlen, Standard ist „Keine“ | bewusst (ui-abgleich) | Phase 1, Abgleich Nr. 17 |
| N3 | Copy | Zwei Felder „Anzeigename“ und „Kurzname“ mit Vorschau `kurzname__tool` und Zähler statt einem Feld „Name“ | bewusst (ui-abgleich) | W6 |
| N4 | Komponenten | Typ-Kacheln ohne Beschreibung („Streamable HTTP, SSE“, „Lokaler Befehl, braucht Freigabe“) | fix | behoben (ab71269) |
| N5 | Copy | „Erweitert“ statt „Erweitert: Limits und Timeouts“ | fix | behoben (ab71269) |
| N6 | Komponenten | Link „mcpServers-JSON importieren“ fehlt | bewusst (ui-abgleich) | Phase 3 |

### stdio-Freigabe

Entwurf: `StdioFreigabe.dc.html` · Route: `/upstreams/up_5/approve`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![stdio-approval Entwurf](ui-review/stdio-approval-mockup.png) | ![stdio-approval vorher](ui-review/stdio-approval-impl.png) | ![stdio-approval nachher](ui-review/stdio-approval-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| ST1 | Layout | Warnung als Banner über einer Karte „Entwurf“ in der App-Hülle, Titel „… wartet auf Freigabe“ gleich | bewusst (ui-abgleich) | gleiche Elemente, andere Anordnung (App-Hülle) |
| ST2 | Copy | Knopf „Freigeben“ statt „Freigeben und starten“ | bewusst (ui-abgleich) | Abgleich Nr. 21: Prozess startet lazy |
| ST3 | Copy | Arbeitsordner „wird vom Server festgelegt“ statt `/data/stdio/christian` | bewusst (ui-abgleich) | W14 |
| ST4 | Komponenten | Prüfliste ohne Haken/Ausrufezeichen je Voraussetzung (stdio global, Konto freigegeben, Befehl geprüft) und ohne Sperrgründe | Entscheidung nötig | offen: Sperrgründe liefert `/api/me/capabilities` (Abgleich Abschnitt 2) |

### Auth-Link: Token eingeben

Entwurf: `AuthLink.dc.html` · Route: `/link/abc`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![auth-link Entwurf](ui-review/auth-link-mockup.png) | ![auth-link vorher](ui-review/auth-link-impl.png) | ![auth-link nachher](ui-review/auth-link-impl-after.png) |
| ![auth-link mobil Entwurf](ui-review/auth-link-m-mockup.png) | ![auth-link mobil vorher](ui-review/auth-link-m-impl.png) | ![auth-link mobil nachher](ui-review/auth-link-m-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| A1 | Copy/Layout | Titel „Zugangsdaten für duckdb“ statt „Token für sentry eingeben“; Restzeit stand im Fuß; Block Upstream/URL/Auth, Erfolgs-/Fehlerkasten „Verbindungstest erfolgreich“ und Fußhinweis „zurück ins Coding-Tool“ fehlten; Hinweis „Wird verschlüsselt gespeichert …“ gekürzt | fix | behoben (03e3516), Test mockup-parity |
| A2 | Komponenten | Eingabefeld ist leer, Entwurf zeigt Beispieltoken | bewusst (ui-abgleich) | Abgleich Nr. 22 |
| A3 | Layout | Logo steht über der Karte (gemeinsames Auth-Layout), im Entwurf in der Karte | bewusst (ui-abgleich) | Layout `auth` gilt auch für Login/Consent |

### OAuth-Zustimmung

Entwurf: `Consent.dc.html` · Route: `/consent?client_id=agent-x&sig=ok`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![consent Entwurf](ui-review/consent-mockup.png) | ![consent vorher](ui-review/consent-impl.png) | ![consent nachher](ui-review/consent-impl-after.png) |
| ![consent mobil Entwurf](ui-review/consent-m-mockup.png) | ![consent mobil vorher](ui-review/consent-m-impl.png) | ![consent mobil nachher](ui-review/consent-m-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| C1 | Komponenten | Scope `mcpwarden:admin` fehlt | bewusst (ui-abgleich) | Entscheidung 5: bis Phase 2 ausgeblendet |
| C2 | Copy | Scope-Name `mcp:tools` statt `mcp`, Zusatzzeile „angemeldet bleiben“ | bewusst (ui-abgleich) | W2 |
| C3 | Layout | Logo über der Karte (wie A3); Zeitangabe „vor 2 Min.“ statt „vor 2 Minuten“ | bewusst (ui-abgleich) | gemeinsames Layout, Kurzformat der App |

### Statistik

Entwurf: `Statistik.dc.html` · Route: `/stats`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![stats Entwurf](ui-review/stats-mockup.png) | ![stats vorher](ui-review/stats-impl.png) | ![stats nachher](ui-review/stats-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| S1 | Komponenten | Säulendiagramm ohne Zeitachse („vor 24 h“ / „jetzt“), oberster Gitterwert abgeschnitten | fix | behoben (03e3516), Test mockup-parity |
| S2 | Farben | Alle Fehlerbalken orange; Entwurf: Timeout/Upstream-Fehler rot, Begrenzungen grau (Text trägt die Bedeutung weiter) | fix | behoben (03e3516) |
| S3 | Copy | Tabellenkopf „Je Upstream“ ohne Untertitel; Entwurf „Latenz je Upstream“ mit Erklärung zum Overhead | fix | behoben (03e3516) |
| S4 | Copy | Kennzahlen „Pro Minute“, „Spitze gleichzeitig“ statt „Aufrufe pro Minute“, „Gleichzeitig, Spitze“ | fix | behoben (03e3516) |
| S5 | Copy | Ergebnisse deutsch („Erfolgreich“, „Tool-Fehler“) statt Rohwerten `ok`, `tool_error` | bewusst (ui-abgleich) | Abgleich Nr. 28 |
| S6 | Komponenten | Filter „Alle Upstreams“ fehlt | Entscheidung nötig | offen: API `stats/summary` kennt `upstream`, UI nutzt es nicht |
| S7 | Daten | Gitterlinie „500“ im Entwurf sitzt bei ≈ 615; Umsetzung rechnet proportional | bewusst (ui-abgleich) | Abgleich Nr. 27 (Fehler im Entwurf) |

### Clients

Entwurf: `Clients.dc.html` · Route: `/settings/connections`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![clients Entwurf](ui-review/clients-mockup.png) | ![clients vorher](ui-review/clients-impl.png) | ![clients nachher](ui-review/clients-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| CL1 | Komponenten | Karte „Was Clients sehen“ (Direkt/Meta-Tools) fehlt | bewusst (ui-abgleich) | Phase 3 |
| CL2 | Copy | Untertitel zeigt Redirect-Host statt Gerät; Spalte „Status“ (Aktiv/Inaktiv) zusätzlich; Berechtigung als Klartext | bewusst (ui-abgleich) | Entscheidung 7, W2, W7 |
| CL3 | Komponenten | „Widerrufen“ ohne Rahmen | fix | behoben (siehe D5) |

### Personal Access Tokens

Entwurf: `Tokens.dc.html` · Route: `/settings/tokens`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![tokens Entwurf](ui-review/tokens-mockup.png) | ![tokens vorher](ui-review/tokens-impl.png) | ![tokens nachher](ui-review/tokens-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| TK1 | Copy | Überschrift „Tokens“ statt „Personal Access Tokens“, Untertitel anders | fix | behoben (ee12262), Krume bleibt „Tokens“ |
| TK2 | Komponenten | „Widerrufen“ ohne Rahmen; Spalte „Status“ zusätzlich (widerrufene Tokens bleiben sichtbar) | fix | behoben (siehe D5); Spalte bewusst |

### Audit-Log

Entwurf: `Audit.dc.html` · Route: `/audit`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![audit Entwurf](ui-review/audit-mockup.png) | ![audit vorher](ui-review/audit-impl.png) | ![audit nachher](ui-review/audit-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| AU1 | Copy | Überschrift „Audit“ statt „Audit-Log“ | fix | behoben (ee12262) |
| AU2 | Komponenten | Reiter „Anmeldung“ fehlt | bewusst (ui-abgleich) | Abgleich Nr. 30: keine Datenquelle |
| AU3 | Komponenten | Kategorien als Pillen mit Rahmen statt Unterstreichung, 44 px | fix | behoben (03e3516 / ab71269) |
| AU4 | Farben | Ergebnis nur als Text ohne Punkt und Statusfarbe | fix | behoben (03e3516), Test mockup-parity |

### Admin: Nutzer und Einladungen

Entwurf: `Admin.dc.html` · Route: `/admin/users`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![admin-users Entwurf](ui-review/admin-users-mockup.png) | ![admin-users vorher](ui-review/admin-users-impl.png) | ![admin-users nachher](ui-review/admin-users-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| AN1 | Komponenten | Zusätzlich Limits, Löschen, Entsperren, Liste offener Einladungen | bewusst (ui-abgleich) | Abgleich Abschnitt 2 (Lücken des Entwurfs), W5 |
| AN2 | Copy | Untertitel „Registrierung nur per Einladung oder Allowlist“ fehlt | bewusst (ui-abgleich) | Entscheidung 2 |
| AN3 | Komponenten | „Sperren“, „Löschen“, „Widerrufen“ ohne Rahmen | fix | behoben (siehe D5) |
| AN4 | Layout | Button „+ Einladung erzeugen“ im Seitenkopf statt im Abschnitt | Entscheidung nötig | offen, rein optisch |

### Admin: Clients (DCR)

Entwurf: `AdminClients.dc.html` · Route: `/admin/oauth`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![admin-oauth Entwurf](ui-review/admin-oauth-mockup.png) | ![admin-oauth vorher](ui-review/admin-oauth-impl.png) | ![admin-oauth nachher](ui-review/admin-oauth-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| AC1 | Layout | Modus als senkrechte Liste mit eigenem Wortlaut statt drei Kacheln nebeneinander | Entscheidung nötig | offen, rein optisch |
| AC2 | Komponenten | Zusatzspalte „Name-Muster“, Warnkasten im Modus „Offen“, Spalten „Allowlist“ und „Verfall“ in der Clientliste | bewusst (ui-abgleich) | Spec P0-2 |
| AC3 | A11y | Entfernen „✕“ war ein kleiner Textknopf ohne 44-px-Fläche | fix | behoben (ee12262) |
| AC4 | Komponenten | „Widerrufen“ ohne Rahmen | fix | behoben (siehe D5) |

### Admin: Instanz

Entwurf: `AdminInstanz.dc.html` · Route: `/admin/settings`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![admin-settings Entwurf](ui-review/admin-settings-mockup.png) | ![admin-settings vorher](ui-review/admin-settings-impl.png) | ![admin-settings nachher](ui-review/admin-settings-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| AI1 | Komponenten | Statt drei Kästchen: Schalter für stdio, Liste „SSRF-Ausnahmen“ mit „+ Eintrag“, Hinweis zur Registrierung | bewusst (ui-abgleich) | W9, Entscheidung 2 |

### Einstellungen

Entwurf: `Settings.dc.html` · Route: `/settings`

| Entwurf | Umsetzung vorher | Umsetzung nachher |
|---|---|---|
| ![settings Entwurf](ui-review/settings-mockup.png) | ![settings vorher](ui-review/settings-impl.png) | ![settings nachher](ui-review/settings-impl-after.png) |
| ![settings mobil Entwurf](ui-review/settings-m-mockup.png) | ![settings mobil vorher](ui-review/settings-m-impl.png) | ![settings mobil nachher](ui-review/settings-m-impl-after.png) |

| # | Aspekt | Befund | Einstufung | Status |
|---|---|---|---|---|
| SE1 | Komponenten | E-Mail ändern, Benachrichtigungen (3), Konto löschen fehlen; es gibt nur den Schalter „E-Mail bei Statuswechsel“ | bewusst (ui-abgleich) | Entscheidung 3 (Stand 2026-11-05) |
| SE2 | Komponenten | Auswahl System/Hell/Dunkel fehlt | bewusst (ui-abgleich) | Entscheidung 8 |
| SE3 | Copy | Sitzungen ohne Gerätenamen („MacBook Pro“); Untertitel mit Verweis auf Clients fehlte | fix | behoben (Verweis nachgetragen); Gerätenamen bewusst (Entscheidung 7) |
| SE4 | Komponenten | „Passwort ändern“ als gefüllter Hauptknopf, Entwurf: Umrandet | fix | behoben (03e3516) |
| SE5 | A11y | Schalter „Anzeigen“ im Passwortfeld nur 24 px hoch (AA-Mindestgröße erfüllt, Ziel des Plans 44 px) | Entscheidung nötig | offen: Eingabegruppe 44 px, innerer Knopf kleiner |

## Offene Entscheidungen

- **D6** (Dashboard (+ eingeklappt)): „Braucht Aufmerksamkeit“ steht unter der Tabelle, im Entwurf als Seitenspalte rechts daneben. offen: mit KPI-Zeile und Diagramm (Phase 2) sinnvoll, vorher ohne Nutzen.
- **U4** (Upstreams (Liste)): Zeitfenster „Letzte 7 Tage“ im Kopf fehlt. Wirkung auf Liste ungeklärt (Abgleich Punkt 8).
- **U7** (Upstreams (Liste)): Seitenfuß „Zeige 1–7 von 7 · 10 pro Seite“: Paging fehlt. offen: bei 50 Upstreams (Limit) ist Paging verzichtbar.
- **T1** (Upstream-Detail): Upstream-Liste mit 24 Balken links neben dem Detail fehlt. offen: Navigation Detail zu Detail; Balken brauchen Phase 2.
- **T7** (Upstream-Detail): Statuschip steht rechts im Seitenkopf, im Entwurf neben der Überschrift im Inhalt. offen, rein optisch.
- **T8** (Upstream-Detail): Tools-Tabelle liegt im Reiter „Tools“, im Entwurf unter der Übersicht. offen: Entwurf nennt Reiter „Tools“ nicht ausgearbeitet.
- **ST4** (stdio-Freigabe): Prüfliste ohne Haken/Ausrufezeichen je Voraussetzung (stdio global, Konto freigegeben, Befehl geprüft) und ohne Sperrgründe. offen: Sperrgründe liefert `/api/me/capabilities` (Abgleich Abschnitt 2).
- **S6** (Statistik): Filter „Alle Upstreams“ fehlt. offen: API `stats/summary` kennt `upstream`, UI nutzt es nicht.
- **AN4** (Admin: Nutzer und Einladungen): Button „+ Einladung erzeugen“ im Seitenkopf statt im Abschnitt. offen, rein optisch.
- **AC1** (Admin: Clients (DCR)): Modus als senkrechte Liste mit eigenem Wortlaut statt drei Kacheln nebeneinander. offen, rein optisch.
- **SE5** (Einstellungen): Schalter „Anzeigen“ im Passwortfeld nur 24 px hoch (AA-Mindestgröße erfüllt, Ziel des Plans 44 px). offen: Eingabegruppe 44 px, innerer Knopf kleiner.

## Tests

Neu: `tests/ui/e2e/mockup-parity.spec.ts` (Strukturprüfungen ohne Pixel-Snapshots: Tabelle ohne Querscrollen bei 1440 px und erreichbare 44-px-Aktionen, Reiter 44 px mit 2 px Unterstreichung in `--primary`, umrandete Zeilenaktionen, Audit-Ergebnis mit Punkt und Text, Statistik-Zeitachse und Titel, Auth-Link-Kopf, Typ-Kacheln, Seitentitel). Bestehende Tests blieben unverändert; ihre Erwartungen („Tokens“, „Audit“ als Teil der Überschrift) gelten weiter.
