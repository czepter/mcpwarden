# UI-Abgleich: Entwürfe gegen Spec v0.4 und Backend-Pläne

Stand: 2026-11-04 · Quelle der Entwürfe: Claude-Artefakt `EXj4fJ9FsvkUjZ3o5hVEcM`, Ordner `project/` (16 Boards, Version `1793826323-7d61`) · Spec: `docs/spec.md` v0.4 · Pläne: `docs/plans/phase-0a.md`, `phase-0b.md`, `phase-1.md` · Folgedokument: `docs/plans/frontend.md`

Lesehilfe: **Phase** nennt die Backend-Phase, die Daten oder Funktion liefern muss. Zu Phase 2 und 3 gibt es noch keinen Plan; dort steht „Plan: nein“. Aussagen über Bibliotheksversionen stehen im Frontend-Plan.

## 1. Bildschirm-Inventar

Gemeinsame Hülle (Dashboard, Main, Detail, Statistik, Clients, Tokens, Audit, Admin*, Settings): linke Seitenleiste mit Logo „m“, Gruppen **Betrieb** (Dashboard, Upstreams mit Zähler-Badge „3“, Statistik), **Zugang** (Clients, Tokens), **System** (Audit, Admin), unten Einstellungen, Nutzerblock (Initialen, Name, E-Mail) und „Einklappen“. Breite 248 px ausgeklappt, 64 px eingeklappt (nur Icons, Gruppenüberschrift wird zur Linie, Badge wird zum Punkt, `title`/`aria-label` je Link). Unter 700 px Breite wird die Leiste zu einer waagerechten Leiste. Kopf je Seite: Brotkrumen „Home › …“, `h1`. Der Akzent ist als Eigenschaft wählbar (Standard `#3730a3`). Nur der Einklappen-Schalter ist interaktiv; Links zeigen auf die anderen Boards.

| Board | Zweck | Hauptelemente | Zustände (gezeigt / fehlt) | Daten und Felder | Aktionen |
|---|---|---|---|---|---|
| `Dashboard` | Überblick: wer ist verbunden, was braucht Aufmerksamkeit | 4 Kennzahlen (Clients online „4 von 6“, Aufrufe/min, Erfolgsquote, Gateway-Overhead p95 mit Ziel ≤ 50 ms); Tabelle „Verbundene Clients“ (Name, Gerät, Anmeldung OAuth/Token, Status Online/Inaktiv, „seit“, Rate, „Tools im Kontext“ in Tokens); Karte „Braucht Aufmerksamkeit“ (3 Upstreams mit Status und Meldung); Liniendiagramm Aufrufe/min | gezeigt: gefüllt, Badge „nicht in Allowlist“ je Client. Fehlt: leer (neue Instanz, keine Clients), Laden, Fehler, „nichts zu tun“ in der Aufmerksamkeitskarte | Client: Name, Untertitel, Anmeldeart, Status, Zeitstempel, Aufrufe/min, Kontextgröße; Upstream: Name, Status, Meldung | Dropdowns „Letzte Stunde“, „Auto-Refresh“; „Widerrufen“ je Client; Link „Alle Clients und Tokens“; Zeile in „Aufmerksamkeit“ → Detail |
| `DashboardCollapsed` | wie `Dashboard`, Seitenleiste eingeklappt | identisch; nur `collapsed=true` | zeigt nur die schmale Leiste | – | – |
| `Main` (Upstreams) | Liste und Überblick aller Upstreams | Filterzeile (Suche, Status, Typ, Tags); 5 Statuskarten mit Balken (Healthy 3, Degraded 1, Breaker offen 1, Auth abgelaufen 1, Deaktiviert 1); Tabelle: Name mit Kürzel und URL/Befehl, Status-Chip, Typ (http/stdio/rest), Tools „aktiv / gesamt“, p95, 24 Balken „Letzte 24 Aufrufe“, Meldung | gezeigt: alle 5 Status, Seitenfuß „Zeige 1–7 von 7 · 10 pro Seite“. Fehlt: leer (kein Upstream), Laden, Fehler, Filter ohne Treffer, Zustand „wartet auf Auth/Freigabe“ | s. Spalten; Zähler je Status | „Letzte 7 Tage“, „Auto-Refresh“, Filter, „Alle testen“, „JSON importieren“, „+ Upstream hinzufügen“, je Zeile „Verbindung testen“ und „Bearbeiten“ |
| `Detail` (Upstream) | Einzelansicht eines Upstreams (Beispiel `linear`, degraded) | Liste aller Upstreams links (Suche, Status, 24 Balken); Kopf mit Status-Chip; Tabs Übersicht/Tools/Auth/Aufrufe (nur Übersicht ausgearbeitet); 5 Kennzahlen (p50, p95, Overhead p95, Fehlerquote, Aufrufe/min); Karte Details (Typ, URL, Auth „OAuth, verbunden · läuft in 6 Tagen ab“, Rate-Limit „60 / min · 5 parallel“, Timeouts „10 s · 15 s · 60 s“) mit Warnbox; Karte „Status, letzte 24 Stunden“ (24 Balken, „Verfügbar 91,7 %“, Heatmap 7 Tage × 24 h mit Legende); Linienchart p50/p95/p99; „Fehler nach Art“ (Timeout, Upstream-Fehler, Rate-Limit, Breaker offen mit Anzahl und Ø Dauer); Tool-Tabelle (Name, Beschreibung, Art lesend/schreibend/löschend, Fehler, p95, Schalter aktiv) | gezeigt: degraded. Fehlt: Tabs Tools/Auth/Aufrufe, healthy/open/auth_expired/disabled, Laden, Fehler, Ergebnis von „Verbindung testen“, Dialog „Löschen“ | s. Karten | „Verbindung testen“, „Deaktivieren“, „Bearbeiten“, „Löschen“, Zeitfenster, Auto-Refresh, Tool-Schalter (wirkt sofort) |
| `UpstreamNeu` | Upstream anlegen (Beispiel `sentry`, OAuth) | Typ-Kacheln HTTP / stdio („braucht Freigabe“) / REST; Name; Server-URL; Anmeldung Keine/Bearer/Header/OAuth mit Hinweis „kein Secret hier“; aufklappbar „Erweitert“: Aufrufe/min 60, Parallel 5, Timeout pro Aufruf 60 s; Link „mcpServers-JSON importieren“ | gezeigt: HTTP + OAuth. Fehlt: Formulare für stdio und REST, Header-Name, Secret-Feld bei Bearer/Header, Validierungsfehler, Laden beim Anlegen, gesperrtes stdio mit Grund | name, url, authType, rate_per_min, max_concurrent, call-Timeout | „Anlegen und verbinden“, „Abbrechen“, Import-Link |
| `StdioFreigabe` | Entwurf eines per MCP angelegten stdio-Upstreams prüfen | Titel „duckdb wartet auf Freigabe“, Alarmbox „startet einen Prozess auf dem Server“; Befehl (Monospace), Arbeitsordner, Umgebung, Netzwerk-Hinweis; Prüfliste (3 Punkte) | gezeigt: Freigabe möglich. Fehlt: stdio global aus, Konto nicht freigegeben, Container ohne Capabilities, Image `slim` | command, args, cwd, env-Namen, Herkunft (Client, Uhrzeit) | „Verwerfen“, „Freigeben und starten“ |
| `AuthLink` | Link-Seite: Token eintragen (aus `add_upstream`) | Karte: Upstream, URL, Auth „Bearer-Token“; Passwortfeld mit „Anzeigen“; Hinweis „nie wieder angezeigt, nur ersetzen“; Erfolgsmeldung „14 Tools gefunden“; Fußzeile „zurück ins Coding-Tool“; „Link läuft in 14 Minuten ab, gilt nur einmal“ | gezeigt: Test erfolgreich. Fehlt: Test fehlgeschlagen, Link abgelaufen/verbraucht, fremder Nutzer (403), Variante Header (mit Header-Name), OAuth-Rückkehrseite „verbunden“ und „nicht unterstützt“ | upstream, url, authType, Restzeit | „Testen“, „Speichern“, „Anzeigen“ |
| `Consent` | OAuth-Zustimmung für einen unbekannten DCR-Client | Kopf „Zugriff erlauben?“, „Angemeldet als …“; Warnbox „nicht in der Allowlist“ (Name, Redirect, Registriert vor 2 Minuten per DCR); Berechtigungsliste (`mcp`, `mcpwarden:admin` mit Erläuterung); Pflicht-Checkbox; Fuß „jederzeit unter Clients widerrufen“ | gezeigt: unbekannter Client. Fehlt: bekannter Client (ohne Warnung und ohne Pflicht-Checkbox), Fehler (Signatur ungültig), Loopback-Zusatzwarnung, deaktivierter Button bis zum Häkchen | client.name, redirect_uris, registriert-am, allowlisted, Scopes | „Ablehnen“, „Zugriff erlauben“ |
| `Statistik` | Kennzahlen je Zeitfenster | Fensterwahl 5 min/1 h/24 h/7 d; „Alle Upstreams“-Filter; 5 Kennzahlen (Gesamt, pro Minute, Erfolgsquote, Spitze gleichzeitig, aktive Clients); Säulen Aufrufe/Stunde; „Ergebnis der Aufrufe“ (7 Status als Balken); Tabelle je Upstream: Aufrufe, Erfolg, p5, p50, p75, p95, p99, Overhead p95 | gezeigt: 24 h. Fehlt: leer, Laden, Fehler, Filter je Tool, Ø/Max-Dauer | s. Tabelle | Fensterwechsel, Upstream-Filter, Link auf Detail |
| `Clients` | Autorisierte Clients und Tool-Modus | Karte „Was Clients sehen“: Direkt / Meta-Tools (Radio); Tabelle: Client, Gerät, autorisiert, zuletzt verbunden, Berechtigung („Tools“, „Tools und Verwaltung“) | gezeigt: 5 Clients. Fehlt: leer, Bestätigung vor Widerruf | client, sub, since, last, scope | Radio, „Widerrufen“ |
| `Tokens` | Personal Access Tokens | „+ Token erzeugen“; grüne Bannerzeile mit Klartext einmalig und „Kopieren“; Tabelle Name, „Beginnt mit“, erstellt, zuletzt benutzt | gezeigt: frisch erzeugt. Fehlt: Dialog „Token benennen“, leer, Limit erreicht (20), Bestätigung vor Widerruf | name, prefix, created, lastUsed | „+ Token erzeugen“, „Kopieren“, „Widerrufen“ |
| `Audit` | Audit-Log | Tabs Alle/Verwaltung/Anmeldung/Status/Abgelehnt; Tabelle Zeit, Client, Aktion (Monospace), Ziel, Ergebnis (Erfolgreich, Wartet auf Freigabe, Abgelehnt, Statuswechsel) | gezeigt: 8 Zeilen. Fehlt: leer, Paging, Zeitraumfilter, Laden | ts, client, action, target, result | Tab-Filter |
| `Admin` (Tab Nutzer) | Nutzer und Einladungen | Tabs Nutzer/Clients (DCR)/Instanz; Hinweis „nur Metadaten“; „+ Einladung erzeugen“; grüne Zeile mit Einladungslink (einmalig, 7 Tage); Tabelle Nutzer, Rolle, Upstreams „x / 50“, letzte Aktivität, stdio erlaubt (Checkbox), „Sperren“ | gezeigt: 3 Nutzer. Fehlt: Löschen, gesperrter Zustand/„Entsperren“, Bestätigungsdialog, Liste offener Einladungen, Limits je Nutzer | email, role, upstreamCount, lastActivity, stdioAllowed | Einladung erzeugen/kopieren, Checkbox, „Sperren“ |
| `AdminClients` | DCR-Policy, Allowlist, registrierte Clients | Radiogruppe Aus / Nur Allowlist / Offen mit Warnung (Standard); Allowlist-Tabelle (7 Einträge mit Redirect-Mustern, „✕“); Tabelle „Registrierte Clients“ (Name, Redirect-URIs, erstellt, zuletzt genutzt, Nutzer, „In Allowlist“, Verfall in 24 Tagen, „Widerrufen“) | gezeigt: 4 Clients. Fehlt: Dialog „+ Eintrag“, leer, Bestätigungen | s. Spec P0-2 | Modus, „+ Eintrag“, „✕“, „Widerrufen“ |
| `AdminInstanz` | Instanzschalter | 3 Schalter: stdio global, SSRF-Schutz lockern, Registrierung per Allowlist | gezeigt: stdio an | 3 Booleans | Schalter |
| `Settings` | Konto des Nutzers | Profil (Name, E-Mail), Passwort (Mindestens 12 Zeichen), Web-Sitzungen (3, „Abmelden“), Darstellung (System/Hell/Dunkel, Leiste eingeklappt als Standard), E-Mail-Benachrichtigungen (3 Schalter), Konto löschen | gezeigt: Standard. Fehlt: Fehler/Erfolg je Abschnitt, Dialog „Konto löschen“ | name, email, sessions, theme, notification flags | „Speichern“, „Passwort ändern“, „Abmelden“, Radio, Checkboxen, „Konto löschen“ |

`canvas.json` legt nur die Anordnung der 16 Boards fest; die Notiz nennt „shadcn-vue zinc, Radius 6/10, Inter“ und „Statusfarben tragen immer auch ein Textlabel“.

## 2. Abdeckung Spec → UI

Zeichen: **ja** = Entwurf vorhanden und vollständig genug, **teils** = Entwurf vorhanden, Teile fehlen (Spalte „Lücke“), **kein Entwurf**.

| Spec | Anforderung mit Oberfläche | Entwurf | Lücke / Hinweis |
|---|---|---|---|
| Einstieg (Ziel 1, US 1) | Nutzer findet die MCP-URL `https://<host>/mcp` und einen Einrichtungsbefehl | kein Entwurf | Leerzustand des Dashboards: URL, Kopierknopf, Beispiel `claude mcp add --transport http …`, PAT-Variante (0b-Plan, Aufgabe 11) |
| P0-2 Login | `/login`, `/register` (erster Nutzer = Admin) | kein Entwurf | von 0a gefordert; auch Registrierung mit Einladung, Fehlertexte (403 geschlossen), Weiterleitung mit signierter OAuth-Query |
| P0-2 Consent | Consent mit Warnung für unbekannte Clients, aktive Bestätigung | teils (`Consent`) | bekannter Client, Fehlerseite, Loopback-Warnung, Scope-Namen |
| P0-2 DCR-Admin | Modus aus/Allowlist/offen, Allowlist pflegen | ja (`AdminClients`) | Dialog „+ Eintrag“ fehlt |
| P0-2 Clients | Admin: Registrierungen mit Name, Redirect-URIs, erstellt, zuletzt genutzt, Nutzeranzahl, Widerruf, Verfall 30 d | ja (`AdminClients`) | Bestätigung vor Widerruf |
| P0-2 / US | Nutzer: pro Client zuletzt verbunden, einzeln widerrufen | ja (`Clients`, `Dashboard`) | Dashboard und Clients überschneiden sich (siehe Abschnitt 3) |
| P0-3 | PAT erzeugen, benennen, widerrufen, Klartext einmalig, zuletzt benutzt | teils (`Tokens`) | Erzeugen-Dialog, Leerzustand, Limit 20 (0b-Plan) |
| P0-4 Nutzerverwaltung | Einladung (Link, einmalig, ablaufend), Liste, sperren, löschen, nur Metadaten | teils (`Admin`) | Löschen, Entsperren, Bestätigung, offene Einladungen, Annahmeseite des Links |
| P0-4 Limits je Nutzer | Upstreams (50), Verbindungen, Aufrufe/min, stdio-Freigabe, per Admin änderbar | teils (`Admin`) | nur stdio-Checkbox und „x / 50“ (nicht editierbar); Rest kein Entwurf |
| P0-5 Upstream-CRUD | anlegen, ändern, löschen, deaktivieren, testen (Tools oder Fehler) | teils (`Main`, `UpstreamNeu`, `Detail`) | Bearbeiten-Formular, Löschdialog, Testergebnis-Panel, stdio-Formular |
| P0-5 stdio-Freigabe | nur mit Admin-Freigabe; UI nennt den Grund einer Sperre | teils (`StdioFreigabe`, `Admin`) | Sperrgründe („Admin“, „Container ohne Capabilities“, „Supervisor nicht erreichbar“, „Image slim“) fehlen |
| P0-5 Rate-Limit je Upstream | 60/min, 5 parallel einstellbar, Treffer im Status | ja (`UpstreamNeu`, `Detail`) | Treffer nur als Zeile in „Fehler nach Art“ |
| P0-6 Secrets | Eingabe maskiert, nie anzeigen, nur ersetzen | teils (`AuthLink`) | „Ersetzen“ im Detail (Tab Auth) und Env-Secrets für stdio fehlen; Secret-Feld im Formular fehlt |
| P0-7 Tool-Filter | Tool ein/aus, sofort wirksam | ja (`Detail`) | Kennzeichnung neuer/verschwundener Tools fehlt |
| P0-8 REST-Tools | Editor (Name, Methode, URL-Template, Header/Query/Body, JSON-Schema, Secret-Referenz, Timeout, Größenlimit) | kein Entwurf | nur Typ-Kachel und Zeile „local · 3 REST-Tools“ |
| P0-9 SSRF | Admin-Setting für interne Ziele; verständliche Fehlermeldung | teils (`AdminInstanz`) | Schalter statt Liste; Meldung „Ziel nicht erlaubt (SSRF-Schutz)“ fehlt |
| P0-12 Auth-Link Token | Seite mit Eingabe, Maskierung, Speichern, Test, „zurück ins Tool“ | teils (`AuthLink`) | Fehler, abgelaufen, 403, Header-Variante |
| P0-12 Auth-Link OAuth | Start serverseitig, Callback zeigt „verbunden“ | kein Entwurf | Rückkehrseite Erfolg/Fehler |
| P0-12 stdio-Entwurf | „wartet auf Freigabe“, Bestätigung in der Web-UI | ja (`StdioFreigabe`) | Zustand in der Liste fehlt |
| P0-12 Audit | Verwaltungsaktionen sichtbar | ja (`Audit`) | Leer, Paging |
| P0-13 Upstream-OAuth | Anmeldeart OAuth, Scopes sichtbar, `auth_expired` mit neuem Link, „nicht unterstützt“ | teils (`UpstreamNeu`, `Detail`) | Scopes, Knopf „Neu verbinden“, Meldung „nicht unterstützt“ |
| P0-14 Status | 5 Status mit Zeitpunkt, Perzentilen, letzter Fehlermeldung | teils (`Main`, `Detail`, `Dashboard`) | Detail zeigt nur p50/p95/p99; `unknown` und „wartet auf …“ fehlen |
| P0-14 Zusatz | Breaker-Zeitpunkt, Ausblenden der Tools offener Upstreams (konfigurierbar), Idempotent-Freigabe je Tool | teils | Countdown „00:42“ ja; Schalter „Tools ausblenden“ und „idempotent“ kein Entwurf |
| P0-15 Statistik-Seite | je Upstream und je Tool: Perzentile, Fehlerquote, Verlauf; Fenster 5 min/1 h/24 h/7 d | teils (`Statistik`) | je Tool fehlt; Ø/Max-Dauer fehlen; Verlauf nur Aufrufe/h |
| P0-15 Admin | aggregierte Instanzzahlen ohne Inhalte | kein Entwurf | |
| P0-15 Kontextgröße | `tools/list`-Größe in Tokens je Client | ja (`Dashboard`) | |
| Admin-Einstellungen | stdio global, SSRF-Aufweichung, Registrierung | ja (`AdminInstanz`) | Retention (14 Tage/13 Monate, „konfigurierbar“), Limits-Defaults, `stdio_idle_min`, `stdio_max_procs` fehlen |
| Audit-Log | Verwaltungsaktionen, Statuswechsel nach `open`/`auth_expired` | ja (`Audit`) | Filter „Anmeldung“ hat keine Datenquelle (Abschnitt 3) |
| P1 Meta-Tool-Modus | Direkt oder Meta-Tools pro Nutzer | ja (`Clients`) | Phase 3 |
| P1 Import | `mcpServers`-JSON importieren, Export ohne Secrets, Vorlagenliste | teils | Schaltflächen ja, Dialog, Export und Vorlagenliste kein Entwurf |
| P1 Aufruf-Log | Zeit, Client, Tool, Dauer, Status | kein Entwurf | `Audit` ist nicht der Aufruf-Log |
| P1 Poisoning-Prüfung | gesperrte Tools manuell freigeben | kein Entwurf | Phase 4 |
| Leer-/Fehler-/Ladezustände | für alle Listen und Karten | kein Entwurf | durchgängig |

## 3. Abdeckung UI → Spec (Überschuss und Widersprüche)

Jeder Punkt nennt Datei und Stelle. „UI-only“ = weder Spec noch Plan fordern es.

| # | Datei / Stelle | Befund | Art |
|---|---|---|---|
| 1 | `Dashboard`, KPI „Aufrufe pro Minute“, Notiz „Limit 60 / min pro Client“ | Spec: 60/min gilt je **Upstream** (P0-5); je Nutzer und je Token gibt es eigene Limits (Plan 1: `calls_per_min` 120 je Nutzer). Ein Limit „pro Client“ gibt es erst als Aufrufbudget in Phase 3 | Widerspruch |
| 2 | `Dashboard`, Spalte Status „Online/Inaktiv“, Untertitel „verbunden seit 2 h 14 min“, „Sitzung offen“ | Das Gateway ist zustandslos (P0-1), es gibt keine Verbindung oder Sitzung. Messbar ist nur der letzte Aufruf (Token-/Client-`last_used`) und offene `subscriptions/listen`-Streams | Widerspruch |
| 3 | `Dashboard`/`Clients`, Untertitel „MacBook Pro“, „Arbeits-PC“, „agent.example.org“ | Gerätenamen liefert weder DCR noch ein PAT. Verfügbar sind Client-Name, Redirect-Host, Zeiten | UI-only, nicht lieferbar |
| 4 | `Dashboard`, Spalte „Aktion: Widerrufen“ und Spalte „Anmeldung: Token“ (nas-cron) | Dashboard mischt OAuth-Clients und PATs; `Clients` zeigt nur OAuth, `Tokens` nur PATs. Widerruf eines PAT von hier verlangt andere API | Konsistenz |
| 5 | `Dashboard`/`Main`/`Detail`, Meldung „p95 über 3× der 7-Tage-Basislinie“, Detail-Warnbox „Status wechselt auf healthy, sobald …“ | Spec P0-15 definiert `degraded` so, aber erst in Phase 2. Plan 1 definiert `degraded` als 1–4 Fehler in Folge. Der Text darf nicht fest im UI stehen | Zeitlicher Widerspruch |
| 6 | `Main`, Filter „Tags ⌄“ | Tags kommen in Spec und Plänen nicht vor | UI-only |
| 7 | `Main`, Schaltfläche „Alle testen“ | nicht in Spec; erzeugt Last auf allen Upstreams (Rate-Limit, Breaker zählen mit) | UI-only |
| 8 | `Main`, „Letzte 7 Tage ⌄“ und „Auto-Refresh ⌄“ | Wirkung des Fensters auf Liste (p95, Balken) nicht definiert; Auto-Refresh nicht in Spec (reines Polling, unkritisch) | unklar |
| 9 | `Main`, Navigationsbadge „3“ | Bedeutung nicht definiert (Annahme: Upstreams mit `degraded`, `open`, `auth_expired`) | unklar |
| 10 | `Main`, Spalte „Letzte 24 Aufrufe“ und `Detail`, „Status, letzte 24 Stunden“ | Gleiche 24 Balken mit zwei Bedeutungen (letzte 24 Aufrufe / 24 Stunden). Daten dafür liefert kein Plan | unklar |
| 11 | `Main`, Status-Chip „Deaktiviert“ mit Meldung „Vom Nutzer deaktiviert“ | passt zu `disabled`; Status `unknown` (Plan 1) und Zustand „wartet auf Auth/Freigabe“ (Spec P0-12) fehlen | Lücke |
| 12 | `Detail`, „Verfügbar 91,7 %“ und Heatmap 7 Tage × 24 h | Verfügbarkeit und Status-Historie stehen nicht in der Spec; Plan 1 speichert den Status nur beim Wechsel | UI-only, braucht neue Daten |
| 13 | `Detail`, Spalte „Art“ (lesend/schreibend/löschend) | Spec kennt „sensibel“ erst in Phase 3 und `readOnlyHint`/`idempotentHint` aus Upstream-Annotationen. Ableitbar, aber nicht gefordert | UI-only, ableitbar |
| 14 | `Detail`, Tool-Spalten „Fehler“ und „p95“ je Tool | Spec P0-15 verlangt Perzentile je Tool, Plan 1 liefert sie erst in Phase 2 | Phase 2 |
| 15 | `Detail`, Tabs „Auth“ und „Aufrufe“ | „Aufrufe“ wäre der optionale Aufruf-Log (P1, Parameter nicht gespeichert); „Auth“ nötig für Ersetzen von Secrets und OAuth-Scopes | unfertig |
| 16 | `UpstreamNeu`, Feld „Name“ mit Hinweis „Kurzname für Tool-Präfixe“ | Spec trennt nichts, Plan 1 hat `name` und `slug` (Regex `^[a-z0-9][a-z0-9-]{0,31}$`, 32 Zeichen). Der Entwurf zeigt weder Regel noch Länge | Lücke |
| 17 | `UpstreamNeu`, Anmeldung „OAuth“ vorausgewählt | Upstream-OAuth ist Phase 2 (P0-13); Phase 1 kennt none/bearer/header/env. Standardwert sollte „Keine“ sein | Phase |
| 18 | `UpstreamNeu`, „Timeout pro Aufruf (s) = 60“ | Spec: Verbinden 10 s, `tools/list` 15 s, `tools/call` 60 s, je Upstream überschreibbar. Entwurf bietet nur den Aufruf-Timeout (Detail zeigt alle drei) | Teilmenge |
| 19 | `UpstreamNeu`, Link „mcpServers-JSON importieren“ und `Main` „JSON importieren“ | P1 (Phase 3) | Phase 3 |
| 20 | `StdioFreigabe`, „Arbeitsordner /data/stdio/christian“ | Spec: `DATA_DIR/stdio/<uid>`; Plan 1: keine Nutzer-ID im Pfad, UID vom Supervisor | Widerspruch |
| 21 | `StdioFreigabe`, Knopf „Freigeben und starten“ | Der Prozess startet lazy beim ersten Aufruf (Spec P0-5); die Prüfliste sagt es selbst („beim ersten Aufruf“) | Begriff |
| 22 | `AuthLink`, Eingabefeld mit vorbefülltem Beispieltoken, Knopf „Anzeigen“ | Anzeigen des eben eingetippten Werts ist unkritisch; gespeicherte Secrets dürfen nie angezeigt werden (P0-6). Beispielwert darf nie ausgeliefert werden | Hinweis |
| 23 | `AuthLink`, „gilt nur einmal“ + Knopf „Testen“ vor „Speichern“ | Unklar, ob Test den Link verbraucht (Spec: einmal verwendbar, 15 min) | Lücke |
| 24 | `Consent`, Scope `mcp` und `mcpwarden:admin`; `Clients`, Spalte „Berechtigung“ | Spec/Plan 0b: `mcp:tools`, daneben `openid`, `offline_access`. `mcpwarden:admin` wird erst in Phase 2 vergeben | Widerspruch |
| 25 | `Consent`, Berechtigungen ohne Auswahl | Spec: Admin-Scope „separat ausweisbar“. Ob der Nutzer ihn abwählen kann, ist offen | offen |
| 26 | `Consent`, nur Redirect voll sichtbar | Plan 0b fordert Redirect-Host immer prominent und Zusatzwarnung bei `localhost` | Lücke |
| 27 | `Statistik`, Y-Achse (Säulen) | Gitterlinie „500“ liegt auf dem Wert ≈ 615 (Säulenhöhe = Wert/1000·130 px, Linie bei y=70) | Fehler im Entwurf |
| 28 | `Statistik`, Status der Aufrufe in Rohschreibweise (`tool_error`, `breaker_open`, …) | entspricht der Spec, aber der Rest der UI ist deutsch; `Detail` nutzt deutsche Namen für dieselben Status | Begriff |
| 29 | `Statistik`, nur Filter „Alle Upstreams“ | Spec: auch je Tool | Lücke |
| 30 | `Audit`, Tab „Anmeldung“ | Plan 1 schreibt keine Login-Ereignisse in `audit_log`; Better Auth speichert Sessions, nicht Ereignisse | UI-only |
| 31 | `Audit`, Spalte „Ergebnis“ (4 Werte) | `audit_log` (Plan 1) hat kein Ergebnisfeld, nur `meta`; „Abgelehnt“ bei `invoke_tool` gehört in Phase 3 (Routing) | Lücke |
| 32 | `Audit`, Sichtbarkeit | Spec nennt nicht, ob Nutzer nur eigene und Admins fremde Einträge sehen | offen |
| 33 | `Admin`, Einladungslink `…/invite/7Hk2…xQ9a`, „7 Tage gültig“ | Spec: Link, einmalig, ablaufend (Dauer nicht festgelegt). Plan 1: Einladung = E-Mail-Allowlist ohne Token, Link ist `<BASE_URL>/register` | Widerspruch Spec/Plan/UI |
| 34 | `Admin`, kein „Löschen“, kein „Entsperren“ | Spec P0-4 fordert Löschen; Plan 1.1.10 Sperren, Entsperren, Löschen | Lücke |
| 35 | `AdminInstanz`, Schalter „SSRF-Schutz für interne Ziele lockern“ | Plan 1: Liste `ssrf.allow` (CIDR oder Hostname), kein Boolean. Ein globaler Schalter öffnet auch Metadaten-IPs | Widerspruch |
| 36 | `AdminInstanz`, Schalter „Registrierung per Allowlist“ | Spec: „Einladung oder Allowlist“; Plan 1 vereint beides in `user_invite`. Der Entwurf hat keine Stelle, die Allowlist zu pflegen | Widerspruch |
| 37 | `AdminClients`, Muster `https://claude.ai/api/mcp/auth_callback`, `cursor://anysphere.cursor-retrieval/*`, `zed://*` | Plan 0b: Claude-Web-Callback „unverifiziert“; Spec nennt `cursor://`, `vscode://`. Die konkreten Muster sind unverifiziert | unverifiziert |
| 38 | `Settings`, „E-Mail ändern, per Link bestätigen“, „E-Mail-Benachrichtigungen“ (3 Schalter) | Es gibt keinen Mailversand (Plan 1: Einladung ohne Mailversand; keine SMTP-ENV in P0-10). Benachrichtigung ist in der Spec nur „optional (P1)“; „Neuer Client verbunden“ und „Wöchentliche Zusammenfassung“ fehlen komplett | UI-only |
| 39 | `Settings`, „Mindestens 12 Zeichen“ | Spec und Plan 0a legen keine Mindestlänge fest | Lücke |
| 40 | `Settings`, „Konto löschen“ | Spec: Admin löscht Nutzer. Plan 1.1.10 verbietet Löschen des eigenen Kontos über die Admin-API; der letzte Admin ist geschützt | Widerspruch |
| 41 | `Settings`, „Web-Sitzungen“ | Better-Auth-Funktion (Sitzungsliste, Abmelden); nicht in Spec und Plan 0a verwendet | UI-only, plausibel |
| 42 | `Settings`, Farbschema „Dunkel“ | alle Boards sind nur hell gezeichnet; es gibt keine Dunkel-Werte | UI-only, Werte fehlen |
| 43 | alle Boards, `<link>` auf Google Fonts | Das Gateway ist self-hosted; externer Font-Abruf überträgt IP-Adressen. Schriften lokal ausliefern | Hinweis |
| 44 | alle Boards, Rolle | Es ist nur der Admin „Christian“ gezeichnet. Die Navigation für Nutzer ohne Admin-Rolle (Admin-Gruppe, Audit-Sicht) fehlt | Lücke |

Stimmig mit der Spec: Standardwerte 60/min und 5 parallel (`UpstreamNeu`, `Detail`); Timeouts 10/15/60 s (`Detail`); Zeitfenster 5 min, 1 h, 24 h, 7 d (`Statistik`); Perzentile p5/p50/p75/p95/p99 (`Statistik`); Status-Namen der Aufrufe (`Statistik`); „Overhead p95 ≤ 50 ms“ (`Dashboard`, `Detail`); Verfall nie genutzter Registrierungen nach 30 Tagen (`AdminClients`); Obergrenze 50 Upstreams (`Admin`); Link-Laufzeit 15 min (`AuthLink`: 14 Minuten Rest); „Admin sieht nur Metadaten“ (`Admin*`); Tool-Präfix `sentry__list_issues` (`UpstreamNeu`); Meta-Tools `find_tools`, `describe_tool`, `invoke_tool` (`Clients`); „lohnt ab etwa 50 Tools“ (`Clients`); Hinweis „SSRF-Schutz gilt für stdio nicht“ (`StdioFreigabe`).

## 4. Widersprüche und Begriffsabweichungen mit Empfehlung

| # | Thema | Spec / Plan | UI | Empfehlung |
|---|---|---|---|---|
| W1 | Statusnamen | Spec: `healthy`, `degraded`, `open`, `auth_expired`, `disabled`. Plan 1 ergänzt `unknown`. Spec P0-12 nennt außerdem „wartet auf Token/OAuth/Freigabe“ als Status von `get_upstream_status` | „Healthy“, „Degraded“, „Breaker offen“, „Auth abgelaufen“, „Deaktiviert“; kein `unknown`, kein „wartet auf …“ | **Spec anpassen:** `unknown` aufnehmen und einen zweiten Wert `setup` (`ready`, `awaiting_auth`, `awaiting_approval`) neben dem Health-Status führen; so bleibt der Health-Enum klein und `get_upstream_status` hat beides. **UI anpassen:** API-Werte bleiben englisch, Anzeige über eine Label-Tabelle; Vorschlag deutsch: „In Ordnung“, „Eingeschränkt“, „Breaker offen“, „Auth abgelaufen“, „Deaktiviert“, „Unbekannt“. Grund: eine Quelle für Texte, kein Anglizismus-Mix |
| W2 | Scope-Namen | `mcp:tools`, `openid`, `offline_access`; `mcpwarden:admin` reserviert (Phase 2) | `mcp`, `mcpwarden:admin` | **UI anpassen** (Anzeige-Titel pro Scope, Roh-Name klein in Monospace). `openid`/`offline_access` nicht als eigene Zeilen, sondern als Hinweis „bleibt angemeldet“. Admin-Zeile erst ab Phase 2 |
| W3 | Perzentile | P0-14 verlangt p5/p50/p75/p95/p99 im Status | `Detail`: p50/p95/p99, `Main`: p95; `Statistik`: alle fünf | **UI anpassen:** Detail bekommt die Tabelle mit allen fünf Werten (Chart darf drei Linien zeigen). Grund: sonst fehlt der Spec-Wert „im Status“ |
| W4 | Limits | 60/min und 5 parallel je Upstream; Nutzerlimit 120/min (Plan 1); Token-Limit eigener Zähler | „Limit 60 / min pro Client“ | **UI anpassen:** Karte nennt „Limit je Upstream 60/min“; Nutzer- und Tokenlimit erscheinen erst, wenn Treffer existieren |
| W5 | stdio-Werte | Idle 10 min, 5 Kindprozesse (Spec Frage 6, entschieden); Plan 1: `stdio_idle_min`, `stdio_max_procs` je Nutzer | nirgends sichtbar | **UI ergänzen:** Admin-Tab Nutzer bekommt je Nutzer „Limits“ (Dialog) mit Upstreams, Aufrufe/min, Verbindungen, stdio-Prozesse, stdio-Idle; Standardwerte aus der API, nicht im Code |
| W6 | Slug | `^[a-z0-9][a-z0-9-]{0,31}$`, 32 Zeichen, eindeutig je Nutzer, `__` trennt | „Name“ ohne Regel | **UI anpassen:** getrenntes Feld „Kurzname“ mit Live-Vorschau „sentry__tool“, Zähler x/32, Fehlermeldung bei Kollision (409). Grund: der Slug ist Teil der Tool-Namen und nicht änderbar ohne Client-Folgen |
| W7 | Sitzung / „online“ | zustandslos, keine Sitzung | „Online“, „verbunden seit“, „Sitzung offen“ | **UI anpassen:** „Aktiv“ = Aufruf in den letzten 5 min, sonst „Inaktiv“; Spalte „seit“ wird zu „Zuletzt aktiv“. Ein „verbunden seit“ gibt es nur, wenn eine Listen-Subscription offen ist, und das ist zu zufällig für eine Anzeige |
| W8 | Einladungsmodell | Spec: Link, einmalig, ablaufend. Plan 1 (O5): E-Mail-Allowlist, Link = `/register` | Token-Link `/invite/…`, 7 Tage, plus Schalter „Registrierung per Allowlist“ | **Entscheidung nötig (Frage 2).** Empfehlung: **Plan 1 anpassen** auf Token-Link mit optionaler E-Mail-Bindung (Spec ist bestätigt), `/invite/[token]` als Annahmeseite, Schalter „per Allowlist“ streichen oder als Domain-/E-Mail-Liste in `AdminInstanz` führen. Grund: ohne Mailversand ist ein Token-Link der einzige Weg, der ohne Vorab-Wissen der Adresse klappt |
| W9 | SSRF-Aufweichung | Liste CIDR/Hostnamen (`ssrf.allow`) | ein Boolean | **UI anpassen:** Tabelle mit „+ Eintrag“, Hinweis auf Metadaten-IPs. Grund: Schalter öffnet 169.254.169.254 mit |
| W10 | `degraded` | Spec: langsam oder teilweise Fehler (p95 > 3× Basislinie ab Phase 2); Plan 1: 1–4 Fehler in Folge | Text fest auf Basislinie | **UI anpassen:** Das Backend liefert `statusReason` (Text); UI zeigt ihn nur an |
| W11 | Statusfarben | – | Healthy grün, Degraded gelb, Breaker rot, Auth blau, Deaktiviert grau; Statuspunkt plus Text | passt zur Notiz „Farbe nie allein“. `Detail`-Heatmap trägt nur Farben mit `title`-Text: **UI ergänzen** (Muster oder Tabellenalternative) |
| W12 | Passwortlänge | nicht geregelt | 12 Zeichen | **Spec anpassen** (P0-4: Mindestlänge 12, serverseitig erzwungen; Option in Better Auth ist **unverifiziert**). UI zeigt nur, was der Server prüft |
| W13 | PAT-Format | Plan 0b: `mcpw_pat_` + 32 Byte base64url (43 Zeichen); „Prefix = erste 8 Zeichen“ (wäre `mcpw_pat`) | 32 Hex-Zeichen, „Beginnt mit mcpw_pat_9f3c…“ | **Plan 0b anpassen:** Anzeige-Präfix = `mcpw_pat_` + 4 Zeichen. Der Entwurfstext ist nur Beispiel |
| W14 | stdio-Pfad | `DATA_DIR/stdio/<uid>`; Plan 1: keine Nutzer-ID im Pfad | `/data/stdio/christian` | **UI anpassen:** Pfad vom Server liefern lassen, im UI nicht bauen |
| W15 | Settings-Umfang | Spec: nichts zu Profil, Mail, Selbstlöschung; Plan 1.1.10 verbietet Selbstlöschung | E-Mail-Änderung, 3 Mail-Benachrichtigungen, Konto löschen, Dunkelmodus | **UI anpassen:** Phase 1 bekommt Name, Passwort, Web-Sitzungen, Darstellung (System/Hell; Dunkel erst, wenn Werte vorliegen). Mail-Funktionen und Selbstlöschung bis zur Entscheidung (Frage 3) streichen |
| W16 | Seiten-Zuordnung | 0a: `/`, `/login`, `/register`; 0b: `/consent`, `/settings/tokens`, `/settings/connections`, `/admin/oauth`; Phase 1: `/upstreams`, `/upstreams/new`, `/upstreams/[id]`, `/admin/users`, `/admin/settings` | Navigation Dashboard, Upstreams, Statistik, Clients, Tokens, Audit, Admin (Tabs Nutzer/Clients/Instanz), Einstellungen | **Zuordnung im Frontend-Plan** (Abschnitt Routenkarte): Plan-Pfade bleiben, Navigationstexte folgen dem Entwurf. Die Backend-Pläne beschreiben auch Vue-Seiten; Frontend übernimmt sie (Frage 1) |
| W17 | Begriff „Verbindungen“ vs „Clients“ | Plan 0b: „Verbindungen“, `/api/me/connections` | „Clients“ | **UI-Wort „Clients“** (Spec benutzt es), API-Pfad bleibt |
| W18 | „Aufruf“ vs „Call“, „Breaker“ | Spec: „Circuit Breaker“, „Aufrufe“ | „Breaker offen“ | beibehalten, Glossar im Frontend-Plan |
| W19 | Restzeit Auth-Link | 15 min | „14 Minuten“ | kein Widerspruch (Restzeit); Anzeige aus `expiresAt` berechnen |
| W20 | Statistik-Zahlen | `percentile_cont`, Rollup-Abweichung ≤ 5 % | exakte Werte | Die Fenster der UI (bis 7 d) liegen innerhalb der 14 Tage Rohdaten, also exakte Werte. Nur wenn später längere Fenster aus Rollups kommen, Hinweis „ungefähr“ zeigen |

## 5. Datenbedarf je Bildschirm

Alle Pfade außer `/api/auth/*` sind Vorschläge des Frontend-Plans, soweit der Backend-Plan sie nicht nennt. Typen liegen künftig in `shared/api-types.ts`. „Plan“ sagt, ob der Backend-Plan die Route samt der benötigten Felder vorsieht (ja / teils / nein).

| Bildschirm | Methode Pfad | Antwort (grob) | Phase | Plan |
|---|---|---|---|---|
| Alle (Shell) | GET `/api/auth/get-session` | `{ user:{ id, name, email, role, banned }, session }` | 0a | ja (Better Auth) |
| Login / Registrierung | POST `/api/auth/sign-in/email`, `/sign-up/email`, `/sign-out` | Better-Auth-Antworten, Fehler 403 „Registrierung geschlossen“ | 0a | ja |
| Registrierung per Einladung | GET `/api/invites/:token` (Vorschlag), POST `/api/auth/sign-up/email` mit Token | `{ valid, email? , expiresAt }` | 1 | nein (Plan hat E-Mail-Allowlist) |
| Consent | GET `/api/oauth/consent-info?…` | `{ client:{ name, redirectUris[], allowlisted, registeredAt, viaDcr }, scopes[], resource, loopback }`; Zustimmung per Better-Auth-Client `oauth2.consent` | 0b | teils (Route ja, Felder offen) |
| Settings | POST `/api/auth/update-user`, `/change-password`, GET `/list-sessions`, POST `/revoke-session` | Better-Auth-Antworten (Namen **unverifiziert**) | 0a/0b | nein (nicht im Plan genutzt) |
| Tokens | GET/POST `/api/me/pats`, DELETE `/api/me/pats/:id` | Liste `{ id, name, prefix, createdAt, lastUsedAt, revokedAt }`; POST liefert zusätzlich `token` einmalig | 0b | ja |
| Clients | GET `/api/me/connections`, DELETE `/api/me/connections/:clientId` | `{ clientId, name, scopes[], grantedAt, lastUsedAt, redirectHost }` | 0b | teils (Gerät nicht lieferbar) |
| Clients (Tool-Modus) | GET/PUT `/api/me/preferences` | `{ toolMode:'direct'|'meta' }` | 3 | nein |
| Admin Clients (DCR) | GET/PUT `/api/admin/oauth/policy`; GET/POST/DELETE `/api/admin/oauth/allowlist`; GET `/api/admin/oauth/clients`; DELETE `/api/admin/oauth/clients/:id` | `{ mode }`, Allowlist `{ id, label, namePattern, redirectPatterns[], builtin }`, Clients `{ id, name, redirectUris[], createdAt, lastUsedAt, userCount, allowlisted, expiresInDays? }` | 0b | ja |
| Upstreams (Liste) | GET `/api/upstreams` | je Eintrag `{ id, slug, name, type, url|command, enabled, status, statusReason, statusChangedAt, lastError, toolsEnabled, toolsTotal, nextRetryAt?, p95Ms?, recent?:[ok|warn|err|none ×24], setup }` | 1 (Basis), 2 (`p95Ms`, `recent`) | teils (Basis ja, Aggregate nein) |
| Upstream anlegen/ändern | POST `/api/upstreams`, GET/PATCH/DELETE `/api/upstreams/:id` | Eingabe `{ name, slug, type, url, transport, authType, authHeaderName, rate_per_min, max_concurrent, timeouts, command, args, env, cwd }`; Antwort ohne Secret, mit `hasSecret` | 1 | ja |
| Secret ersetzen | PUT `/api/upstreams/:id/secret` | Eingabe `{ kind, name?, value }`, Antwort `{ hasSecret:true }` | 1 | ja |
| Verbindung testen | POST `/api/upstreams/:id/test` | `{ ok, tools[{name,description}], latencyMs }` oder `{ ok:false, errorCode, message }` | 1 | ja |
| Tools | GET `/api/upstreams/:id/tools`, PUT `/api/upstreams/:id/tools/:name` | `{ name, description, enabled, gone, firstSeenAt, annotations?{ readOnlyHint, destructiveHint, idempotentHint } }`; Fehler und p95 je Tool erst in Phase 2 | 1 (2) | teils (Annotationen nicht genannt) |
| stdio-Fähigkeit | GET `/api/me/capabilities` | `{ stdio:{ allowed, reason? }, limits:{ maxUpstreams, used } }` | 1 | nein (Plan nennt die Meldungen, nicht die Route) |
| stdio-Freigabe | POST `/api/upstreams/:id/approve`, DELETE `/api/upstreams/:id` (verwerfen) | `{ status }`; Entwurf trägt `createdVia:{ client, at }` | 2 | nein |
| Dashboard | GET `/api/dashboard?window=` | `{ kpis:{ clientsActive, clientsTotal, callsPerMin, successRate, overheadP95Ms }, clients[{ kind:'oauth'|'pat', id, name, allowlisted, lastActiveAt, callsPerMin, contextTokens }], attention[{ upstreamId, name, status, message, nextRetryAt? }], series:[{ t, calls }] }` | 2 (Clients-Teil ab 1 möglich) | nein |
| Statistik | GET `/api/stats/summary?window&upstream&tool`; `/api/stats/timeseries`; `/api/stats/upstreams` | Kennzahlen, Stundenreihe, Ergebnis je Status, Zeilen `{ upstream, calls, okRate, p5, p50, p75, p95, p99, overheadP95 }` | 2 | nein (Phase-1-Plan schiebt Seite nach 2) |
| Upstream-Detail (Stats) | GET `/api/upstreams/:id/stats?window` | KPIs, Perzentil-Reihen, Fehler nach Art `{ kind, count, avgMs }`, Tool-Zeilen | 2 | nein |
| Upstream-Detail (Verlauf) | GET `/api/upstreams/:id/health-history?hours=` | `[{ t, state:ok|warn|err|none }]`, `availability` | 2 | nein (Datenmodell speichert nur Wechsel) |
| Audit | GET `/api/audit?category&cursor&limit` | `{ items:[{ ts, actor, clientName, action, targetType, targetLabel, result }], nextCursor }` | 1 (Schreiben), Lesen offen | nein (Schreibpfad ja, Leseroute nein) |
| Auth-Link Token | GET `/api/links/:token`; POST `/api/links/:token/test`; POST `/api/links/:token/submit` | `{ kind:'token'|'header'|'oauth', upstream:{ slug, url }, headerName?, expiresAt, state }`; Test `{ ok, toolCount }`; Fehler 403/410 | 2 | nein |
| Auth-Link OAuth | GET `/api/links/:token/oauth/start` (Redirect), Rückkehrseite `/link/done?status=` | Status `connected` / `unsupported` / `error` | 2 | nein |
| Admin Nutzer | GET `/api/admin/users`; POST `/api/admin/users/:id/ban|unban`; DELETE `/api/admin/users/:id`; PUT `/api/admin/users/:id/limits` | `{ id, email, name, role, banned, createdAt, upstreamCount, lastActivityAt, stdioAllowed, limits }` | 1 | teils (`lastActivityAt`, `stdioAllowed` fehlen in der Beschreibung der Liste) |
| Admin Einladungen | GET/POST/DELETE `/api/admin/invites` | `{ id, createdAt, expiresAt, usedAt, email?, link? }` (Link nur beim Erzeugen) | 1 | teils (E-Mail-Modell) |
| Admin Instanz | GET/PUT `/api/admin/settings` | `{ 'stdio.enabled', 'ssrf.allow':string[], … }` | 1 | ja (Schalter Registrierung offen) |
| Admin Statistik | GET `/api/admin/stats` | aggregierte Zähler ohne Inhalte | 2 | nein |
| Import | POST `/api/upstreams/import`, GET `/api/upstreams/export` | Vorschau und Ergebnis ohne Secrets | 3 | nein |

Hinweis zur Beschaffung: Polling statt Push (Auto-Refresh 15 s / 30 s / 1 min / aus); `ETag` oder `Cache-Control: no-store` für Listen mit Statuswerten bleibt Backend-Entscheidung.

## 6. Offene Fragen

Alle acht Fragen sind **entschieden 2026-11-04** (der Nutzer hat die jeweilige Empfehlung bestätigt). Keine Frage ist mehr offen. Umsetzung in `docs/plans/frontend.md`; die Backend-Pläne und die Spec sind an die Entscheidungen anzupassen (Stand dieses Dokuments: nicht geprüft).

1. **Zuständigkeit für Vue-Dateien** (entschieden 2026-11-04). Das Frontend übernimmt alle `app/**`-Dateien (Seiten, Layouts, Komponenten); die Backend-Phasen liefern API, Tests und Vertragsbeiträge. Betrifft 0a Task 9, 0b Aufgaben 3 bis 5, Phase 1 Aufgaben 1.1.8 bis 1.1.10 und 1.3.5, die ihre Vue-Seiten abgeben. Login (`/login`) und Registrierung/Einladung (`/register`, `/invite/<token>`) sind damit Frontend-Aufgaben.
2. **Einladungsmodell** (W8; entschieden 2026-11-04). Token-Link `/invite/<token>`, 7 Tage gültig, optional an eine E-Mail gebunden. Plan 1 (E-Mail-Allowlist ohne Token) ist anzupassen; der Schalter „Registrierung per Allowlist“ entfällt.
3. **Konto-Funktionen in den Einstellungen** (entschieden 2026-11-04). E-Mail-Änderung, Benachrichtigungsmails und Konto-Selbstlöschung entfallen und werden aus Plan und Entwurfs-Umsetzung gestrichen (kein Mailversand, Widerspruch zu Plan 1.1.10 damit gegenstandslos).
4. **Dashboard-Zeitpunkt** (entschieden 2026-11-04). Dashboard (Clients-Tabelle, Aufmerksamkeitskarte) und Audit-Lesen laufen schon nach Phase 1; Phase 1 liefert dafür zwei zusätzliche Routen: `/api/dashboard` ohne KPIs und `/api/audit`. KPIs und Diagramm folgen mit Phase 2.
5. **Consent und Admin-Scope** (entschieden 2026-11-04). Consent mit zwei Schaltern: `mcp:tools` immer an, `mcpwarden:admin` abwählbar. Der Admin-Scope-Schalter bleibt bis Phase 2 ausgeblendet. Ob der Better-Auth-Consent eine Scope-Teilmenge annimmt, ist unverifiziert.
6. **Audit-Sichtbarkeit** (entschieden 2026-11-04). Nutzer sehen ihre eigenen Einträge, Admins zusätzlich Instanzereignisse (z. B. Nutzer gesperrt, Einstellung geändert).
7. **UI-only-Elemente** (entschieden 2026-11-04). Tags und Gerätenamen werden gestrichen. „Alle testen“ kommt später mit Bestätigung und Rate-Hinweis. Verfügbarkeit und Heatmap werden nur gebaut, wenn Phase 2 `health-history` liefert.
8. **Dunkelmodus** (entschieden 2026-11-04). Nach Phase 2; die Auswahl „System“ (und „Dunkel“) bleibt bis dahin ausgeblendet.
