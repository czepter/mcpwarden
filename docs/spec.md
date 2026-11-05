# mcpwarden — MCP Gateway & Proxy (PRD v0.6)

Stand: 2026-11-05 · Status: Entwurf · Autor: Christian
Änderungen ggü. v0.5 (Entscheidung 2026-11-05):
- **Mailversand ist optional und nicht mehr Nicht-Ziel.** Ohne `SMTP_URL` ändert sich nichts: keine Mails, Einladungen bleiben Links, die Mailfunktionen sind in der UI ausgeblendet, der Betrieb braucht keinen Mailserver. Mit `SMTP_URL` und `MAIL_FROM` schaltet sich der Mailer ein (neu P1 „Mailer“). Gebaut: Passwort-Reset („Passwort vergessen?“), Einladungsmails und Statuswechsel-Benachrichtigungen mit Opt-out je Nutzer. E-Mail-Änderung per Link und Konto-Selbstlöschung bleiben P2.
Änderungen ggü. v0.4 (auf Grundlage von `docs/ui-abgleich.md`, Entscheidungen vom 2026-11-04):
- Zuständigkeit: Das Frontend übernimmt alle `app/**`-Dateien; Backend-Phasen liefern nur API, Tests und Beiträge zu `shared/api-types.ts` (Technische Rahmenbedingungen).
- Einladungen sind Token-Links (`/invite/<token>`, 7 Tage gültig, optional an eine E-Mail gebunden), keine reine E-Mail-Allowlist (P0-4).
- Ohne Mailversand entfallen E-Mail-Änderung per Link, Benachrichtigungsmails und Konto-Selbstlöschung (Nicht-Ziele; Benachrichtigung und Mailfunktionen P2). Passwort-Mindestlänge 12 (P0-4).
- Dashboard (Clients-Tabelle, Aufmerksamkeitskarte) und Audit-Lesen schon in Phase 1 (neu P0-16, `/api/dashboard` ohne KPIs, `/api/audit`); KPIs und Statistik bleiben Phase 2. Audit-Sichtbarkeit: Nutzer sehen eigene Einträge, der Admin zusätzlich Instanzereignisse.
- Consent: `mcpwarden:admin` ist beim Zustimmen separat abwählbar (zwei Schalter); der Consent-Screen blendet den Admin-Scope bis Phase 2 aus (P0-2, P0-12).
- Zustandsloses Gateway: Statuswort „Aktiv“ = Aufruf in den letzten 5 Minuten statt „Online / verbunden seit“ (P0-1, User Stories).
- Statusmenge: `unknown` ergänzt; Einrichtungszustand (`ready` / `awaiting_auth` / `awaiting_approval`) als zweiter Wert neben dem Health-Status; `degraded` einheitlich definiert, Backend liefert `statusReason` (P0-12, P0-14).
- Limits 60/min und 5 parallel gelten je Upstream; Nutzer- und Token-Limits getrennt (P0-4, P0-5, P1). Kurzname (Slug) im Formular sichtbar mit Regex (P0-1, P0-5).
- SSRF-Ausnahme als Admin-Liste (CIDR/Hostname), nicht als Schalter (P0-9).
- Nicht gebaut: Tags und Gerätenamen (Nicht-Ziele). „Alle testen“ später mit Bestätigung und Rate-Hinweis; Verfügbarkeit/Heatmap nur, wenn Phase 2 `health-history` liefert. Dunkelmodus erst nach Phase 2 (Darstellung bis dahin ohne „System“/„Dunkel“).
Änderungen ggü. v0.3 (auf Grundlage von `docs/plans/review.md`):
- SDK-Linie `@modelcontextprotocol/server`/`client` v2; Spec-Revision 2026-07-28 neben 2025-11-25.
- Zustandsloses Gateway (keine Session-ID); `tools/list_changed` über `subscriptions/listen` mit Bus pro Nutzer; Abbruch über HTTP = Stream schließen.
- Upstream-Secrets werden in der Web-App entschlüsselt; der Supervisor bekommt nur die fertige Env eines Kindprozesses (kein `MASTER_KEY`, kein DB-Zugriff).
- Härtungen: Supervisor leitet die UID aus `user_id` ab und ignoriert gelieferte UIDs, getrennte Verzeichnisbäume mit `lchown`, SSRF-Prüfung auch für IP-Literale, Token-Widerruf wirkt sofort (DB-Prüfung pro Request), Registrierungssperre atomar.
- Phasenzuordnung: Admin-Funktionen (P0-4), Minimum von P0-14/P0-15 und Umstiegstest PGlite→Postgres (P0-11) eingeordnet.
- Erweiterte ENV-Liste (`STDIO_MODE`, `TRUST_PROXY`, Test-Schalter); Hinweis auf MRTR (Sampling/Elicitation) der Revision 2026-07-28.
- Zweiter Pflichtclient der OAuth-Abnahme: Cursor; Scope `mcp:tools`; Slug-Limit 32 Zeichen für Upstream-Namen.
Änderungen ggü. v0.2: LLM-gestütztes Routing ist jetzt Ziel (kein Nicht-Ziel mehr); Upstreams lassen sich per MCP selbst anlegen, Secrets und OAuth laufen über einen Link in die Web-UI (nie durch den Chat); Upstream-OAuth deshalb P0.
Änderungen ggü. v0.1: Remote-Hosting in Docker, Gateway als OAuth-2.1-Provider (Better Auth) für Endnutzer, nutzerbezogene Daten, Meta-Tool-Modus, Sicherheitsmodell für öffentliche Erreichbarkeit.

## Problemstellung

Jedes Coding-Tool (Claude Code, Cursor, Claude Desktop/Web, …) pflegt eine eigene Liste von MCP-Servern mit eigener Auth (stdio-Env-Secrets, Bearer, OAuth). Neuer Server oder rotiertes Token heißt: überall nachpflegen. Secrets liegen verstreut in Klartext-Configs. Viele aktive Tools blähen den Kontext jedes Clients auf. Lokale stdio-Server gibt es nur auf dem jeweiligen Rechner, nicht auf allen Geräten.

**mcpwarden** ist ein remote gehosteter Gateway im Docker-Container. Clients verbinden sich mit **einer** URL und melden sich per OAuth an; dahinter hängen beliebig viele Upstreams (stdio, HTTP, REST). Konzeptionell inspiriert von `MikkoParkkola/mcp-gateway` (Meta-Tool-Oberfläche, Import bestehender Client-Configs, REST-Capabilities, Tool-Poisoning-Prüfung), aber als Web-App mit UI und Login statt CLI + YAML, und ohne Rust-Binary.

Zielnutzer: zunächst ich selbst (mehrere Geräte), später ein kleiner Kreis von Freunden/Team. Jeder Nutzer hat eigene Upstreams, Secrets und Tokens; die Nutzer vertrauen sich nur begrenzt, daher gilt von Anfang an harte Mandantentrennung. Geteilte Upstreams für ein Team sind bewusst erst P2.

## Ziele

1. **Eine Verbindung pro Client:** URL eintragen, im Browser per OAuth einloggen, fertig. Unabhängig von Zahl der Upstreams und vom Gerät.
2. **Alle gängigen Upstream-Typen:** stdio, Streamable HTTP (+ Legacy-SSE), REST; Auth none / Bearer / Header / OAuth.
3. **Secrets zentral und verschlüsselt,** keine in Client-Configs.
4. **Kontext schlank durch intelligentes Routing:** Der Client sieht nur wenige Meta-Tools. Für eine Absicht („suche Issues zu X") liefert das Gateway per Keyword-Suche Kandidaten aus dem gesamten Katalog, und das Modell des Clients wählt daraus, per MCP-Sampling oder über den Tool-Dialog; das Gateway betreibt kein eigenes LLM. Der Aufrufer gilt dabei als nicht vertrauenswürdig: Berechtigungen prüft immer der Server. Tools bleiben zusätzlich einzeln schaltbar.
5. **Verwaltung per MCP:** Neue Upstreams legt der Nutzer im Gespräch mit seinem Coding-Tool an. Alles Geheimnisvolle (Token, OAuth-Zustimmung) läuft über einen Link in die Web-UI, nie über den Chat.
6. **Sicher öffentlich erreichbar:** Standard-Deployment ist ein Docker-Container hinter TLS, ohne dass ein offener Endpoint Code ausführen oder interne Netze erreichen kann.
7. **Setup eines Upstreams ≤ 2 min** inkl. Verbindungstest.

## Nicht-Ziele

- **Teams, geteilte Upstreams, Rollenmodell** — v1 kennt nur „Admin" und „Nutzer"; jeder Nutzer sieht nur seine eigenen Upstreams.
- **Marketplace** — nur eine kleine, statische Vorlagenliste gängiger Server (P1).
- **Code-Sandbox für eigene Tools** (JS/Python) — Aufwand und Risiko; REST-Tools genügen.
- **Eigenes LLM im Gateway** (Key, Anbieter, Kosten) — Routing nutzt das Modell des Clients; das Gateway führt nichts autonom aus und plant keine Mehrschrittabläufe.
- **Upstream-OAuth ohne Dynamic Client Registration** (eigene OAuth-App je Dienst, feste Redirect-URIs) — out of scope, bis es jemand braucht.
- **Kommerzieller Betrieb/Abrechnung** — persönliches Tool; eigener Code, kein Code des Vorbilds (siehe Umgang mit dem Vorbild).
- **Managed Serverless** — stdio braucht langlebige Prozesse.
- **Tags für Upstreams und Gerätenamen für Clients** — DCR und PAT liefern keinen Gerätenamen; angezeigt werden nur Client-Name, Redirect-Host und Zeiten.

## User Stories

**Endnutzer mit Coding-Tools**
- Ich trage `https://<host>/mcp` in Claude Code/Cursor/Claude Desktop ein und werde per OAuth durch den Login geführt, damit kein Token manuell kopiert werden muss.
- Ich kann für Clients ohne OAuth-Unterstützung ein Personal Access Token erzeugen und widerrufen, damit auch einfache Tools funktionieren.
- Ich sehe pro Client, wann er zuletzt aktiv war („Aktiv“ = Aufruf in den letzten 5 Minuten, sonst „Inaktiv“; das Gateway ist zustandslos, es gibt keine Verbindung oder Sitzung), und kann einzelne Clients und Tokens widerrufen, damit ein verlorenes Gerät nichts offenlässt.
- Ich sehe auf dem Dashboard, welche Clients aktiv sind und welche Upstreams Aufmerksamkeit brauchen, und kann im Audit-Log nachlesen, was mit meinem Konto geschehen ist.
- Ich schalte Tools einzeln aus oder wähle den Meta-Tool-Modus, damit der Kontext klein bleibt.

**Verwaltung per MCP (aus dem Coding-Tool heraus)**
- Ich sage meinem Coding-Tool „füge den Sentry-MCP hinzu" und das Gateway legt den Upstream an, damit ich dafür keine UI öffnen muss.
- Braucht der Upstream einen Token, erhalte ich einen Link auf die Eingabeseite in der Web-UI, damit das Secret nie in Chat, Modellkontext oder Client-Logs landet.
- Verlangt der Upstream OAuth, erhalte ich einen Link, der direkt zur Zustimmungsseite des jeweiligen Dienstes führt und danach zum Gateway zurück, damit ich nach dem Klick sofort loslegen kann.
- Ich frage „ist Sentry fertig eingerichtet?“ und bekomme Status (wartet auf Auth / wartet auf Freigabe / bereit sowie der Health-Status, siehe P0-14) mit erneutem Link, falls abgelaufen.
- Ich lasse mir Tools suchen („was kann ich zu Issues tun?") und aufrufen, ohne alle Tool-Definitionen im Kontext zu haben.

**Nutzer als Verwalter seiner Upstreams**
- Ich lege Upstreams per Formular an (Transport + Auth) oder importiere eine `mcpServers`-JSON, damit die Migration schnell geht.
- Ich autorisiere OAuth-geschützte HTTP-Upstreams einmal im Browser; Refresh läuft automatisch.
- Ich sehe Status je Upstream (verbunden / Fehler / Auth abgelaufen) mit letzter Fehlermeldung.
- Ich definiere REST-Tools (Methode, URL-Template, Parameter-Schema), damit eine HTTP-API ohne eigenen Server als Tool dient.

**Admin**
- Ich steuere, wer sich registrieren darf (Einladungslink, optional an eine E-Mail gebunden) und ob stdio-Upstreams erlaubt sind, damit ein öffentlicher Endpoint keine Fremden Prozesse starten lässt.
- Ich sehe im Audit-Log zusätzlich Instanzereignisse (Nutzer gesperrt, Einstellung geändert).

**Randfälle**
- Upstream down → andere Upstreams und Gateway unberührt; Fehler klar an den Client.
- Namenskollisionen → Präfix `<upstream>__<tool>`.
- Token/Session widerrufen → wirkt **sofort**: der nächste Request wird mit 401 beendet, auch bei noch gültigem JWT-Access-Token und bei widerrufenem Refresh-Token (Prüfung gegen die DB bei jedem Request, siehe P0-2).

## Anforderungen

### P0 — ohne geht es nicht

**P0-1 Gateway-Endpoint (Streamable HTTP)**
`/mcp` (später `/mcp/:profile`), **zustandslos** nach MCP-Spec-Revision 2026-07-28: keine Session-ID, kein GET-Stream. Unterstützt werden 2026-07-28 und 2025-11-25; ältere (2025er-)Clients werden zustandslos ohne Session bedient (kein `Mcp-Session-Id`).
- [ ] `initialize`, `tools/list`, `tools/call` aus Claude Code funktionieren mit einem Eintrag.
- [ ] Tool-Namen `<upstream>__<tool>`; Upstream-Slugs eindeutig je Nutzer und auf `^[a-z0-9][a-z0-9-]{0,31}$` begrenzt (max. 32 Zeichen), damit der Tool-Name die Längenlimits der Clients einhält. Der Slug ist als „Kurzname“ im Formular sichtbar (Live-Vorschau `<slug>__tool`, Zähler x/32, Fehler bei Kollision) und nach dem Anlegen nicht änderbar, weil er Teil der Tool-Namen ist.
- [ ] **Kein Sitzungsbegriff:** Da das Gateway zustandslos ist, gibt es kein „online“ oder „verbunden seit“. Ein Client gilt als **Aktiv**, wenn sein letzter Aufruf (Client-/Token-`last_used`) höchstens 5 Minuten zurückliegt, sonst als **Inaktiv**; angezeigt wird „Zuletzt aktiv“. Offene `subscriptions/listen`-Streams fließen nicht in die Anzeige ein.
- [ ] **`tools/list_changed`:** Clients der Revision 2026-07-28 erhalten es über `subscriptions/listen` (`notify` des Handlers). Mandantentrennung: Benachrichtigungen gehen nur an Streams des betroffenen Nutzers (Handler oder Bus pro Nutzer, nie ein gemeinsamer Bus ohne Filter nach `user_id`). 2025er-Clients bekommen keinen Push (best effort); sie sehen die Änderung beim nächsten `tools/list`.
- [ ] `tools/call` reicht Ergebnis, Fehler und Content-Typen (text, image, resource) 1:1 durch.
- [ ] `Origin`-Header wird gegen Allowlist geprüft (DNS-Rebinding laut MCP-Spec).
- [ ] Ohne gültige Auth: 401 mit `WWW-Authenticate` und Verweis auf Protected-Resource-Metadata; kein Tool-Leak.

**P0-2 OAuth 2.1 Authorization Server für Clients (Better Auth)**
Das Gateway ist OAuth-Provider; der Endnutzer loggt sich bei Better Auth ein und erteilt Zugriff.
- [ ] Authorization Code + PKCE, Consent-Screen, Refresh-Tokens, Widerruf.
- [ ] Dynamic Client Registration (RFC 7591), damit Claude Desktop/Web/Code/Cursor sich ohne vorab geteilte Client-ID verbinden.
- [ ] Discovery: `/.well-known/oauth-protected-resource` und `/.well-known/oauth-authorization-server`.
- [ ] **DCR-Policy (Admin-Einstellung):** Modus `aus` / `nur Allowlist` / `offen mit Warnung`. Standard: `offen mit Warnung`.
  - Allowlist gängiger Clients vorbelegt (Claude Code, Claude Desktop/Web, Cursor, VS Code, Windsurf, Zed, Codex; Abgleich über Client-Name plus erlaubte Redirect-URI-Muster wie `http://localhost:*`, `http://127.0.0.1:*`, `cursor://`, `vscode://`), Admin kann Einträge ergänzen/entfernen.
  - Bei `nur Allowlist` werden nicht gelistete Registrierungen abgelehnt. Bei `offen mit Warnung` zeigt der Consent-Screen für unbekannte Clients eine deutliche Warnung (Name, Redirect-URI, „nicht in der Allowlist"), und der Nutzer muss aktiv bestätigen.
  - Registrierte Clients sind in der Admin-Seite sichtbar (Name, Redirect-URIs, erstellt, zuletzt genutzt, Nutzeranzahl) und widerrufbar; nie genutzte Registrierungen verfallen nach 30 Tagen.
  - DCR-Endpoint hat Rate-Limit; Redirect-URIs nur `https` oder Loopback/registrierte App-Schemes, keine Wildcards außerhalb der Allowlist-Muster.
- [ ] Access-Token an Audience (= Gateway-URL) gebunden; Token anderer Resources werden abgelehnt.
- [ ] Scope-Name einheitlich `mcp:tools` (daneben `openid`, `offline_access`); `mcpwarden:admin` bleibt für die Verwaltungs-Tools reserviert (P0-12) und wird erst ab Phase 2 vergeben.
- [ ] **Consent-Screen:** Anzeige-Titel je Scope mit dem Roh-Namen klein in Monospace; `openid`/`offline_access` erscheinen nicht als eigene Zeilen, sondern als Hinweis „bleibt angemeldet“. Der Redirect-Host ist immer prominent sichtbar, bei Loopback-Adressen (`localhost`, `127.0.0.1`) gibt es eine Zusatzwarnung. Bekannte Clients (Allowlist) zeigen keine Warnung und brauchen keine Pflicht-Checkbox. Der Nutzer kann `mcpwarden:admin` beim Zustimmen **separat abwählen** (zwei Schalter: `mcp:tools` und `mcpwarden:admin`); bis Phase 2 blendet der Consent-Screen den Admin-Scope aus.
- [ ] **Widerruf wirkt sofort:** Bei jedem Request an `/mcp` prüft das Gateway zusätzlich zur Token-Signatur gegen die DB: Nutzer nicht gesperrt, Client nicht deaktiviert, Consent vorhanden und für (Nutzer, Client) existiert noch ein gültiger Refresh-Token. Damit greifen Sperre, Client-Widerruf und Einzel-Token-Widerruf auch bei noch gültigem JWT (TTL 5 min) sofort; Kosten: eine Query pro Request.
- [ ] Verifikation: realer Verbindungsaufbau aus Claude Code und **Cursor** als zweitem Pflichtclient (lokal, ohne Tunnel; Fallback MCP Inspector). Claude Desktop/Web werden bei der ersten öffentlichen Instanz (Phase 1) nachgezogen. (Better Auth als OAuth-Provider für MCP-Clients ist mit mehreren Tools bereits praktisch getestet; das Ergebnis dient als Referenz für die Abnahme.)

**P0-3 Personal Access Tokens (Fallback)**
- [ ] Erzeugen, benennen, widerrufen; nur Hash gespeichert, Klartext einmalig sichtbar; „zuletzt benutzt".
- [ ] Gelten genau für den erzeugenden Nutzer.

**P0-4 Nutzer & Login**
- [ ] Better Auth, E-Mail/Passwort (Mindestlänge 12 Zeichen, serverseitig erzwungen; die UI zeigt nur, was der Server prüft); erster Nutzer wird Admin; weitere Registrierung nur per **Einladungslink**: ein Token-Link `/invite/<token>`, einmalig verwendbar, 7 Tage gültig, optional an eine E-Mail-Adresse gebunden (dann nur mit dieser registrierbar). Es gibt keine reine E-Mail-Allowlist ohne Token; der Link wird vom Admin weitergegeben (Mailversand der Einladung ist optional, siehe P1 „Mailer“). Die Sperre ist **atomar**: Registrierungen werden serialisiert (prozessweiter Mutex genügt in der Single-Instance), damit zwei gleichzeitige Erstregistrierungen nicht zwei Admins ergeben.
- [ ] Rolle und Sperre (`role`, `banned`) kommen aus dem Better-Auth-`admin()`-Plugin und sind ab der ersten Migration im Schema (Phase 0a); Einladungen (Token-Link) und Nutzerverwaltung folgen in Phase 1, Meilenstein 1.1.
- [ ] Alle Tabellen mit `user_id`; jede Query nutzerbezogen (Test: Nutzer B sieht/ruft nie Upstreams von A).
- [ ] Rate-Limit auf Login- und Token-Endpunkte.
- [ ] Admin-Seite: Einladungen erzeugen (Link `/invite/<token>`, einmalig, 7 Tage gültig, optional E-Mail-gebunden; Link nur beim Erzeugen sichtbar; Liste offener Einladungen mit Widerruf), Nutzer auflisten, sperren und entsperren (Sperre beendet sofort alle Sessions, OAuth-Tokens und PATs des Nutzers), löschen (entfernt auch dessen Upstreams und Secrets; der letzte Admin ist geschützt). Das Löschen des eigenen Kontos durch den Nutzer entfällt vorerst (P2, siehe „Mailer“).
- [ ] Limits je Nutzer sind in der Admin-Seite einsehbar und änderbar (Upstreams, Aufrufe/min, Verbindungen, stdio-Prozesse, stdio-Idle); Standardwerte kommen aus der API, nicht aus dem UI-Code.
- [ ] Admin sieht nur Metadaten (Anzahl Upstreams, letzte Aktivität), nie Secrets oder Aufrufinhalte anderer Nutzer.
- [ ] Pro Nutzer Obergrenzen: Anzahl Upstreams (Standard 50), gleichzeitige Verbindungen, Aufrufe pro Minute (Nutzerlimit, unabhängig vom Upstream-Limit aus P0-5); stdio nur nach Admin-Freigabe (P0-5). Grenzen per Admin änderbar.
- [ ] Jeder Nutzer erhält einen eigenen Verschlüsselungsschlüssel (aus dem Master-Key abgeleitet), damit ein Fehler in einer Abfrage nicht fremde Secrets entschlüsselbar macht.

**P0-5 Upstream-Verwaltung**
Typen: `stdio` (command, args, env, cwd), `http` (Streamable HTTP, Fallback SSE).
- [ ] CRUD in UI; „Verbindung testen“ zeigt Tool-Liste oder konkrete Fehlermeldung. Das Anlegen-Formular kennt die Felder Typ, Name, Kurzname (Slug, siehe P0-1), Auth-Art (Standard „Keine“; „OAuth“ erst ab Phase 2) und die Timeouts (Verbinden, `tools/list`, `tools/call`, siehe P0-14). Der Zustand „wartet auf Auth“ bzw. „wartet auf Freigabe“ erscheint auch in der Upstream-Liste.
- [ ] „Alle testen“ (alle Upstreams einer Liste in einem Zug prüfen) ist nicht Teil von Phase 1; später nur mit Bestätigung und Hinweis auf Rate-Limit und Breaker, die mitzählen. Tags für Upstreams gibt es nicht.
- [ ] stdio: lazy Start, Idle-Timeout, Neustart mit Backoff, Ressourcenlimit (Speicher/Prozessanzahl pro Nutzer), Prozess läuft nicht als root.
- [ ] stdio nur erlaubt, wenn Admin es global und für den Nutzer freigeschaltet hat (Default: nur Admin).
- [ ] **Ein Node-Worker pro Nutzer („stdio-Host"):** Alle stdio-Upstreams eines Nutzers laufen als Kindprozesse in genau einem eigenen Node-Prozess, den der Hauptprozess (Supervisor) startet. Das Gateway spricht mit dem Worker über IPC (Unix-Socket oder stdio-Pipe, nur Hauptprozess darf verbinden) und reicht MCP-Nachrichten durch.
  - Worker startet lazy beim ersten stdio-Aufruf und beendet sich nach Idle-Timeout samt aller Kinder.
  - Worker bekommt eine **saubere Umgebung**: kein `MASTER_KEY`, kein `BETTER_AUTH_SECRET`, keine `DATABASE_URL`, kein Zugriff auf die DB. Die Secrets eines Upstreams werden **in der Web-App** entschlüsselt (sie hält den Schlüssel ohnehin); der Supervisor erhält nur die fertige Env für genau einen Kindprozess und braucht weder `MASTER_KEY` noch DB-Zugriff. Begründung: Der privilegierte Prozess bleibt frei von Schlüsselmaterial und Datenbank, seine Angriffsfläche schrumpft.
  - Eigenes Arbeitsverzeichnis je Nutzer (`DATA_DIR/stdio/<uid>`), `cwd` der Kinder darauf beschränkt; Worker und Kinder laufen unter einer eigenen unprivilegierten UID/GID je Nutzer (Supervisor startet sie mit `uid/gid`), sodass Dateien anderer Nutzer und die DB-Dateien nicht lesbar sind. Läuft der Container ohne die dafür nötigen Rechte, ist stdio für Nicht-Admins gesperrt und die UI sagt warum.
  - **Supervisor vertraut der Web-App nicht bei der UID:** Er ignoriert vom Web-Prozess gelieferte UIDs. Die UID wird aus `user_id` abgeleitet bzw. geprüft (fester Bereich, nie 0, nie die UID der Web-App, `gid = uid`), `cwd` nur unterhalb des eigenen stdio-Baums. Ein gefälschter Befehl (z. B. `uid: 0`) wird abgelehnt.
  - **Getrennte Verzeichnisbäume:** `DATA_DIR` gehört root, die Datenbank (`DATA_DIR/app`) der Web-UID, `DATA_DIR/stdio` root (0711). Nutzerverzeichnisse legt der Supervisor exklusiv an und setzt Besitzer per `lchown` mit Symlink-Prüfung; die Web-App kann den stdio-Baum weder umbenennen noch durch Symlinks ersetzen (Schutz vor Symlink-Angriffen auf `CAP_CHOWN`).
  - Limits je Worker: maximale Zahl Kindprozesse, Speicher (Node `--max-old-space-size` für den Worker, cgroup/`ulimit` für Kinder soweit verfügbar), CPU-Zeit, Laufzeit pro Aufruf. Überschreitung beendet nur diesen Worker; andere Nutzer und das Gateway laufen weiter.
  - Absturz des Workers: Supervisor startet ihn mit Backoff neu, offene Aufrufe liefern einen klaren Fehler.
  - Egress: Kindprozesse dürfen ausgehend frei verbinden (npx/uvx brauchen Netz); SSRF-Schutz aus P0-9 gilt hier **nicht**. Das ist ein bekanntes Restrisiko und der Grund, warum stdio für Nicht-Admins eine bewusste Freigabe bleibt.
  - **Grenze der Isolation:** Ein Prozess pro Nutzer mit eigener UID trennt Dateien, Speicher und Absturzverhalten, teilt aber Kernel und Netzwerk mit dem Container. Es ist keine Sandbox gegen böswillige Nutzer. Härtung (Container pro Nutzer, Netzwerkrichtlinien) bleibt P2.
- [ ] Circuit Breaker, Timeouts, Retry und Health-Check pro Upstream: siehe P0-14.
- [ ] **Rate-Limit pro Upstream:** Aufrufe pro Minute und gleichzeitige Aufrufe, **je Upstream** (nicht je Client) einstellbar (Standard 60/min, 5 parallel; Vorlage: strengere Werte für bekannte Dienste mit eigenen API-Limits). Schützt Upstream-Quotas, API-Kosten und das Gateway vor Schleifen eines fehlgesteuerten Modells.
  - Überschreitung liefert sofort einen Tool-Fehler mit `retry_after` statt Warten oder stillem Verwerfen; Antwort-Header `429`-Äquivalent der Upstreams (`Retry-After`) wird übernommen und senkt das Limit vorübergehend.
  - Zähler je (Nutzer, Upstream), In-Memory (Token-Bucket); Limit-Treffer erscheinen im Upstream-Status der UI und im Aufruf-Log.
  - Zusätzlich globales Limit pro Nutzer (P0-4) und pro Client-Token, damit ein Upstream-Limit nicht durch viele Upstreams umgangen wird.
- [ ] Upstream deaktivieren entfernt dessen Tools sofort; Clients bekommen `tools/list_changed` (Zustellung und Grenzen siehe P0-1).

**P0-6 Upstream-Auth & Secrets**
- [ ] none, Bearer, Custom-Header, Env-Secrets für stdio.
- [ ] AES-GCM-Verschlüsselung, Master-Key aus ENV/Docker-Secret; App startet ohne Key nicht.
- [ ] Entschlüsselung ausschließlich in der Web-App; der Nutzerschlüssel wird aus dem Auth-Kontext abgeleitet, nie aus der Datenzeile (siehe P0-5).
- [ ] Secrets nie im Klartext in UI/Logs; nur „ersetzen".

**P0-7 Tool-Filter**
- [ ] Tool je Upstream ein/aus; Änderung ohne Neustart.

**P0-8 Eigene REST-Tools**
- [ ] Name, Beschreibung, Methode, URL-Template `{param}`, Header/Query/Body-Template, JSON-Schema der Eingabe, Secret-Referenz, Timeout, Antwort-Größenlimit.
- [ ] Erscheinen als Upstream „local" mit denselben Filtern.

**P0-9 SSRF-Schutz**
- [ ] Ausgehende Requests (HTTP-Upstreams, REST-Tools, OAuth-Discovery) blocken Loopback, Link-Local, private Netze und Cloud-Metadaten-IPs; DNS wird vor dem Request aufgelöst und die IP geprüft (Rebinding). Die Prüfung gilt auch für **IP-Literale** in der URL (nach URL-Normalisierung, die Dezimal-/Hex-/Oktalschreibweisen auflöst), nicht nur für DNS-Namen; eingebettete IPv4-Adressen (z. B. 6to4) und Dokumentations-/Testnetze werden mitgeprüft. Weiterleitungen werden nicht automatisch gefolgt. Pro Instanz für bewusst interne Ziele aufweichbar, und zwar als **Admin-Liste** (Einträge als CIDR oder Hostname, Setting `ssrf.allow`), nicht als globaler Schalter, weil ein Schalter auch Metadaten-IPs (169.254.169.254) öffnen würde; die UI weist beim Eintragen darauf hin. Eine geblockte Anfrage meldet verständlich „Ziel nicht erlaubt (SSRF-Schutz)“.

**P0-10 Docker-Deployment**
- [ ] Multi-Stage-`Dockerfile`, Node-Preset, Non-Root-User für die Web-App, `HEALTHCHECK` auf `/healthz`.
- [ ] Beispiel-`compose.yaml` setzt `cap_drop: [ALL]`, `cap_add: [SETUID, SETGID, CHOWN]` und `security_opt: [no-new-privileges:true]`; ein separater Supervisor-Prozess im Container hält die Capabilities (siehe P0-5), die Web-App nicht.
- [ ] Zwei Image-Varianten: `slim` (nur HTTP/REST-Upstreams; stdio ist hier fest abgeschaltet, kein Supervisor-Bundle) und `full` (mit Node/npx und `uv`/`uvx` für stdio-Server).
- [ ] Konfiguration nur per ENV: `BASE_URL`, `BETTER_AUTH_SECRET`, `MASTER_KEY`, `DATABASE_URL` (leer = eingebettetes PGlite im Datenverzeichnis, sonst `postgres://…`), `DATA_DIR`, `ALLOWED_ORIGINS` sowie
  - `STDIO_MODE` (`off` / `auto`; Standard `off` im Image `slim`, `auto` im Image `full`),
  - `TRUST_PROXY` (`X-Forwarded-*` nur auswerten, wenn `true`; sonst gilt `BASE_URL`),
  - ein Test-Schalter für das Better-Auth-Rate-Limit (z. B. `RATE_LIMIT=off`, nur für Testläufe; endgültiger Name im Plan).
  Socket-Pfad des Supervisors und Web-UID/GID sind feste Werte im Image, keine ENV. Daten in einem Volume (PGlite).
- [ ] Läuft hinter TLS-terminierendem Reverse-Proxy (korrekte `X-Forwarded-*`-Behandlung); `BASE_URL` muss HTTPS sein außer bei `localhost`.
- [ ] Migrationen laufen beim Start; `docker compose up` mit Beispiel-`compose.yaml` genügt für lokale Tests.
- [ ] Kein automatisches Deployment in CI vorgesehen; Rollout manuell.

**P0-11 Persistenz (Voraussetzung für P0-2, P0-3, P0-4; wird als Erstes gebaut)**
- [ ] Drizzle mit Postgres-Dialekt (`pg-core`). Standard ist **PGlite** (eingebettetes Postgres, Daten im Volume), Umstieg auf echtes Postgres nur durch Setzen von `DATABASE_URL`, ohne Schema- oder Codeänderung. Beide laufen über denselben Schema- und Migrationssatz.
- [ ] Nur Postgres-kompatibles SQL; keine PGlite-Sonderfunktionen und keine Erweiterungen, die es auf echtem Postgres nicht gibt.
- [ ] Umstieg dokumentiert und getestet: Dump aus PGlite (`pgDump`), Import in Postgres, App startet mit neuer `DATABASE_URL`, Login und Upstreams sind vorhanden (CI-Job). Dieser Umstiegstest gehört zu **Phase 1**, nicht zur Abnahme von Phase 0a; Phase 0a prüft nur, dass derselbe Testsatz gegen beide Backends grün ist.
- [ ] Backup PGlite = Volume kopieren bei gestoppter App oder per Dump-Endpoint/CLI (im README).
- [ ] Better-Auth-Tabellen (user, session, account, verification, OAuth-Client/Code/Token) liegen im selben Drizzle-Schema; Schema wird aus Better Auth generiert, nicht von Hand gepflegt, und Migrationen sind versioniert eingecheckt.
- [ ] Migrationen laufen beim Start idempotent. PGlite ist single-connection: alle Zugriffe laufen über einen gemeinsamen Client im selben Prozess, lange Transaktionen werden vermieden.
- [ ] Eigene Tabellen (Upstreams, Tools, Tokens, Audit) tragen `user_id` mit Fremdschlüssel auf die Better-Auth-Nutzertabelle.

**P0-12 Verwaltungs-Tools per MCP**
Eigener Upstream „mcpwarden" im Gateway mit Tools: `list_upstreams`, `add_upstream` (Typ http/stdio/rest, Name, URL bzw. Befehl, Auth-Art), `update_upstream`, `remove_upstream`, `test_upstream`, `get_upstream_status`, `get_auth_link`, `set_tool_enabled`. Sichtbar nur mit OAuth-Scope `mcpwarden:admin` (im Consent-Screen als eigener Schalter abwählbar, siehe P0-2; Vergabe ab Phase 2). `get_upstream_status` liefert den Health-Status (P0-14) und daneben den Einrichtungszustand `setup` (`ready` / `awaiting_auth` / `awaiting_approval`) samt `statusReason`.
- [ ] `add_upstream` nimmt **nie** Secrets entgegen (Schema hat kein Token-Feld). Fehlt Auth, ist der Upstream angelegt, aber „wartet auf Auth", und die Antwort enthält `auth_link`.
- [ ] Auth-Art `token`/`header` → Link auf Web-Seite mit Eingabefeld (Maskierung, Speichern, Verbindungstest, Rückmeldung „fertig, zurück ins Tool").
- [ ] Auth-Art `oauth` → Link startet den Flow serverseitig (Discovery, DCR, PKCE) und leitet direkt auf die Zustimmungsseite des Dienstes; Callback landet im Gateway und zeigt „verbunden".
- [ ] Links sind signiert, einmal verwendbar, an Nutzer und Upstream gebunden, laufen nach 15 min ab und verlangen Gateway-Login (fremder Nutzer mit Link: 403).
- [ ] Wenn der Client URL-Elicitation (MCP-Spec 2025-11-25) unterstützt, wird der Link darüber geöffnet; sonst als Text/Markdown-Link in der Tool-Antwort. In der Revision 2026-07-28 laufen Elicitation und Sampling über das MRTR-Muster (`InputRequiredResult`: der Server sendet keine eigenen Requests mehr, sondern antwortet mit einer Eingabeaufforderung und erhält die Antwort mit dem erneuten Aufruf); beide Wege werden unterstützt, wo der Client sie bietet.
- [ ] Anlegen eines **stdio-Upstreams per MCP** erzeugt nur einen Entwurf „wartet auf Freigabe" und läuft erst nach Bestätigung in der Web-UI (Schutz vor Prompt-Injection → Codeausführung). HTTP/REST-Upstreams dürfen ohne Bestätigung angelegt werden, werden aber erst nach erfolgreichem Test aktiv.
- [ ] Jede Verwaltungsaktion per MCP landet im Audit-Log (Nutzer, Client, Aktion, Ziel).
- [ ] Verwaltungs-Tools sind im Meta-Tool-Modus immer direkt sichtbar (nicht hinter der Suche).

**P0-13 Upstream-OAuth**
Voraussetzung für P0-12 mit OAuth-Diensten.
- [ ] Authorization Code + PKCE, Discovery (RFC 9728/8414), Dynamic Client Registration; Upstreams ohne DCR sind out of scope (meldet klar „nicht unterstützt").
- [ ] Refresh-Tokens verschlüsselt gespeichert, automatische Erneuerung vor Ablauf; bei dauerhaftem Fehler Status „Auth abgelaufen" plus neuer Link per `get_auth_link`.
- [ ] Scopes sichtbar, `state` und PKCE-Verifier an Sitzung gebunden, Redirect-URI fest auf `BASE_URL`.

**P0-14 Resilienz je Upstream (Timeout, Retry, Circuit Breaker, Health-Check)**
*Phase 1 (Minimum):* Timeouts, einfacher Circuit Breaker, Status, `/healthz`, `/readyz`, Graceful Shutdown. *Phase 2 (Rest):* aktiver Ping/Health-Check, Idempotent-Retry für `tools/call`, Latenz-Perzentile im Status.
Ergänzt den knappen Circuit-Breaker-Punkt in P0-5; hier steht das vollständige Verhalten.
- [ ] **Timeouts:** Verbindungsaufbau 10 s, `tools/list` 15 s, `tools/call` 60 s Standard; je Upstream und je Tool überschreibbar. Bei Überschreitung wird der Aufruf abgebrochen und der Client erhält einen klaren Fehler mit Ursache „Timeout".
- [ ] **Abbruch je Transport:** Über HTTP (Revision 2026-07-28) bedeutet Abbruch, den Antwort-Stream zu schließen; `notifications/cancelled` wird nur dort gesendet, wo es zutrifft (stdio sowie Legacy-Upstreams der Revision 2025-11-25). Gilt auch, wenn der Client seine Anfrage abbricht.
- [ ] **Retry mit Augenmaß:**
  - Automatisch wiederholt werden nur Verbindungsaufbau, Initialisierung und `tools/list` (3 Versuche, exponentielles Backoff mit Jitter, Start 500 ms, Deckel 10 s).
  - `tools/call` wird **nicht** blind wiederholt, weil Tools schreiben können. Ausnahme: nur wenn der Upstream das Tool mit `readOnlyHint`/`idempotentHint` markiert oder der Admin es als idempotent freigibt, dann 1 Wiederholung bei Verbindungsfehler oder 5xx. Fehler des Tools selbst (`isError`) werden nie wiederholt.
  - Sitzungsverlust beim Upstream (z. B. HTTP 404 auf Session-ID) führt zu einer neuen Initialisierung und genau einem erneuten Versuch, auch bei nicht-idempotenten Tools, solange die Anfrage nachweislich nicht verarbeitet wurde.
- [ ] **Circuit Breaker** mit drei Zuständen: *geschlossen* → nach 5 aufeinanderfolgenden Fehlern oder > 50 % Fehlerquote in 30 s → *offen* (Aufrufe scheitern sofort mit „Upstream vorübergehend gesperrt", Dauer 30 s, wachsend bis 5 min) → *halboffen* (ein Probeaufruf; Erfolg schließt, Fehler öffnet erneut). Zählt Verbindungsfehler, Timeouts und 5xx, nicht Fehler durch ungültige Argumente oder `isError` des Tools.
- [ ] **Health-Check je Upstream:**
  - Aktiv: HTTP-Upstreams alle 60 s per `ping` (MCP) bzw. leichtem `tools/list`-Check; stdio-Prozesse über Prozess-Lebenszeichen und `ping`, **nur wenn der Prozess ohnehin läuft** (kein Start nur für den Check).
  - Passiv: Ergebnis echter Aufrufe fließt in den Status ein.
  - Status in der UI und via `get_upstream_status`: `healthy` / `degraded` / `open` (Breaker offen) / `auth_expired` / `disabled` / `unknown` (noch kein Ergebnis, z. B. frisch angelegt), jeweils mit Zeitpunkt, Latenz-Perzentilen (alle fünf, p5/p50/p75/p95/p99, siehe P0-15; die Detailansicht zeigt alle fünf Werte, ein Chart darf drei Linien zeigen) und letzter Fehlermeldung. Daneben führt jeder Upstream den **Einrichtungszustand** `setup`: `ready` / `awaiting_auth` / `awaiting_approval` (Spec P0-12: „wartet auf Auth“ bzw. „wartet auf Freigabe“). So bleibt der Health-Enum klein. API-Werte bleiben englisch, die Anzeige läuft über eine Label-Tabelle (deutsch: „In Ordnung“, „Eingeschränkt“, „Breaker offen“, „Auth abgelaufen“, „Deaktiviert“, „Unbekannt“).
  - **`degraded`** heißt: der Upstream antwortet, aber eingeschränkt. In Phase 1: 1–4 aufeinanderfolgende Fehler (unterhalb der Breaker-Schwelle); ab Phase 2 zusätzlich p95 über 3× der 7-Tage-Basislinie. Das Backend liefert den konkreten Grund als `statusReason` (Text); die UI zeigt ihn nur an und kodiert keine Schwellen fest.
  - Statusfarben tragen immer auch ein Textlabel; Darstellungen, die nur über Farbe unterscheiden (z. B. eine Verlaufs-Heatmap), brauchen Muster oder eine Tabellenalternative.
  - Statuswechsel nach `open` oder `auth_expired` erzeugen einen Eintrag im Audit-Log; Benachrichtigung per E-Mail an den Besitzer über den optionalen Mailer (siehe P1 „Mailer“; ohne `SMTP_URL` nur Audit-Eintrag).
  - Verfügbarkeit in Prozent und eine Status-Historie (Heatmap) gibt es nur, wenn Phase 2 den Verlauf speichert und über `health-history` liefert; bis dahin speichert das Datenmodell den Status nur beim Wechsel.
  - Tools eines `open`-Upstreams bleiben in `tools/list` sichtbar (kein Flackern der Tool-Liste im Client), liefern aber den Fehler; konfigurierbar, sie auszublenden.
- [ ] **Gateway-Health:** `/healthz` (Prozess lebt, DB erreichbar) und `/readyz` (Migrationen durch, Supervisor erreichbar, falls aktiviert). Ein ausgefallener Upstream macht das Gateway weder „unhealthy" noch „not ready".
- [ ] **Bulkhead:** Ein langsamer oder hängender Upstream darf keine Verbindungen/Worker der anderen belegen (eigene Concurrency-Limits aus dem Rate-Limit, getrennte Pools je Upstream).
- [ ] **Graceful Shutdown:** Bei `SIGTERM` keine neuen Aufrufe, laufende bis 30 s zu Ende, danach Abbruch; stdio-Worker werden beendet, SSE/Streamable-Sitzungen erhalten ein sauberes Ende.
- [ ] Test: Fake-Upstream mit steuerbarem Verhalten (hängt, wirft 500, verliert Session, antwortet langsam) prüft Timeout, Retry-Grenzen (kein Doppelaufruf bei nicht-idempotentem Tool), Breaker-Zustandswechsel und Status.

**P0-15 Basis-Statistiken pro Aufruf**
*Phase 1 (Minimum):* Schreibpfad der Messdaten (Puffer, Felder, Aufbewahrung). *Phase 2 (Rest):* Perzentile, Rollups, Statistik-Seite, `get_stats`, Routing-Statistik.
Jeder Aufruf (`tools/call`, `tools/list`, Verwaltungs-Tools, Routing-Schritte) schreibt einen schlanken Messdatensatz. Nur Metadaten, nie Argumente oder Ergebnisse (Inhalte speichert erst der optionale Aufruf-Log, P1).
- [ ] **Felder je Aufruf:** Zeitpunkt, Nutzer, Client/Token-ID, Upstream, Tool, Aufrufart, Status (`ok` / `tool_error` / `timeout` / `upstream_error` / `rate_limited` / `breaker_open` / `denied`), Gesamtdauer, **Upstream-Dauer**, **Gateway-Overhead** (Gesamt minus Upstream), Retry-Anzahl, Größe von Anfrage und Antwort in Bytes, Cache-Treffer (ja/nein).
- [ ] **Perzentile:** p5, p50, p75, p95, p99 der Gesamtdauer sowie Upstream-Dauer und Gateway-Overhead, je Upstream und je Tool, über wählbare Fenster (letzte 5 min, 1 h, 24 h, 7 d). Berechnung mit `percentile_cont` direkt in Postgres/PGlite (gleiche SQL-Funktion in beiden Backends) auf den Rohdaten; Rollups werden als Histogramm-Buckets gespeichert, damit Perzentile auch nach dem Löschen der Rohdaten ungefähr rekonstruierbar bleiben (Abweichung dokumentiert, Ziel ≤ 5 %).
- [ ] **Weitere Basiszahlen:** Aufrufe gesamt, Aufrufe pro Minute, Erfolgsquote, Fehlerquote je Status, Anteil Timeouts/Rate-Limit-Treffer/Breaker-Sperren, gleichzeitige Aufrufe (Spitze), Durchschnitts- und Maximaldauer, Anzahl aktiver Clients, `tools/list`-Größe in Tokens (grob, Zeichen/4) je Client.
- [ ] **Schreibpfad bremst nie den Aufruf:** Datensätze werden in einem Puffer im Speicher gesammelt und gebündelt geschrieben (alle 5 s oder 500 Einträge); Pufferüberlauf verwirft die ältesten Einträge und zählt die Verluste (`stats_dropped`). Ausfall der Statistik darf nie einen Aufruf fehlschlagen lassen.
- [ ] **Aufbewahrung:** Rohdaten 14 Tage, Stunden-Rollups (Zähler + Histogramm) 13 Monate; konfigurierbar. Tägliche Aufräum-Aufgabe.
- [ ] **Sichtbarkeit:** Statistik-Seite in der UI (je Upstream und je Tool: Tabelle der Perzentile, Fehlerquote, Verlauf als Zeitreihe), und MCP-Tool `get_stats(upstream?, tool?, window)` für den eigenen Nutzer. Jeder Nutzer sieht nur eigene Zahlen; Admin sieht aggregierte Instanzzahlen ohne Inhalte.
- [ ] **Routing-Statistik** (sobald Routing existiert): Anzahl `find_tools`, Kandidatenzahl, gewählte vs. angebotene Tools, Anteil Sampling vs. Tool-Dialog, Anteil verworfener (ungültiger) Auswahlen.
- [ ] Die Perzentile fließen ab Phase 2 in den Health-Status (P0-14, `degraded`, wenn p95 über 3× der 7-Tage-Basislinie liegt) und in das Erfolgskriterium „Gateway-Overhead p95 ≤ 50 ms".
- [ ] Test: Lastskript mit bekannter Verteilung (z. B. 10 000 Aufrufe mit Dauern 10–1000 ms) – berechnete p5/p50/p75/p95/p99 weichen um ≤ 2 % vom Erwartungswert ab, Overhead-Berechnung stimmt, Pufferüberlauf zählt Verluste statt zu blockieren.

**P0-16 Dashboard und Audit-Lesen (Phase 1)**
Die Daten (`last_used_at`, Status, Messdatensätze, Audit-Schreibpfad) liegen nach Phase 1 vor; darum laufen Clients-Tabelle, Aufmerksamkeitskarte und Audit-Ansicht schon dort. KPIs, Statistik-Seite und Diagramme bleiben Phase 2.
- [ ] `GET /api/dashboard` (ohne KPIs): Clients (OAuth und PAT, je Name, Anmeldeart, Allowlist-Status, „Zuletzt aktiv“, Aktiv/Inaktiv nach P0-1) und Aufmerksamkeitsliste (Upstreams mit `degraded`, `open`, `auth_expired`, `awaiting_auth`, `awaiting_approval`, jeweils mit `statusReason`). Ohne Gerätenamen. Leerzustand (neue Instanz) zeigt die MCP-URL `https://<host>/mcp`, einen Kopierknopf, den Einrichtungsbefehl und die PAT-Variante.
- [ ] `GET /api/audit?category&cursor&limit`: Verwaltungsaktionen und Statuswechsel mit Zeit, Akteur, Client, Aktion, Ziel und Ergebnis. Ein Reiter „Anmeldung“ entfällt, solange keine Login-Ereignisse im Audit-Log stehen.
- [ ] **Sichtbarkeit:** Jeder Nutzer sieht nur eigene Einträge; der Admin sieht zusätzlich Instanzereignisse (Nutzer gesperrt, Einstellung geändert), nie Aufrufinhalte oder Secrets anderer Nutzer.

### P1 — schnell danach

- **Mailer (optional, SMTP).** Aktiv nur mit `SMTP_URL` (`smtps://user:pass@host:465` oder `smtp://host:587` mit Pflicht-STARTTLS, Klartext nur an localhost) und `MAIL_FROM`; beides wird beim Start geprüft (ungültig oder `MAIL_FROM` fehlt = Startfehler, Meldungen nennen nie Zugangsdaten). Ohne `SMTP_URL` ist der Mailer ein No-op, `GET /api/public-config` liefert `mail: false`, und alle Mailfunktionen sind unsichtbar. Dieselbe öffentliche Route meldet `registrationOpen` (true nur, solange noch kein Nutzer existiert); Login- und Registrierungsseite lesen daraus, ob sie „Registrieren“ anbieten. Die Anwendung kennt nur den Port `Mailer.sendMail({to, subject, text, html?})` (Adapter: SMTP, No-op, In-Memory für Tests).
  - Härtung: CR/LF in Empfänger, Betreff und Absender werden abgelehnt (Header-Injection), nur Klartext und einfaches, escaptes HTML aus festen Vorlagen, Links ausschließlich aus `BASE_URL`, Timeouts (Verbinden, Gruß, Socket, Senden), höchstens 2 Wiederholungen bei vorübergehenden Fehlern (nicht bei Auth- oder 5xx-Fehlern), Limit je Empfänger (3 pro Stunde), Versandfehler brechen nie eine Anfrage ab und werden ohne Adresse, Token und Zugangsdaten geloggt.
  - [x] **Passwort-Reset:** „Passwort vergessen?“ (nur sichtbar, wenn `mail` aktiv ist), `/forgot-password` und `/reset-password`. Die Antwort ist für bekannte und unbekannte Adressen gleich (auch zeitlich: der Versand wird nicht abgewartet), Token 15 Minuten gültig und einmalig, im Link als Fragment (kein Access-Log), Mindestlänge 12, danach enden alle Sitzungen des Nutzers.
  - [x] **Einladungsmails:** `POST /api/admin/invites` nimmt optional `sendMail: true` (nur mit gebundener Adresse und aktivem Mailer, sonst 422 mit `field: sendMail`). Der Link `/invite/<token>` (Pfad wie in der UI; das Token ist einmalig und 7 Tage gültig) geht zusätzlich an die gebundene Adresse; der Admin sieht den Link weiter genau einmal. Die Antwort trägt `mailQueued`. Versand im Hintergrund, Limit je Empfänger und Header-Injection-Schutz gelten, Fehler brechen das Anlegen nie ab, das Token steht in keinem Log. UI: Kästchen „Per E-Mail senden“ im Einladungsdialog, nur sichtbar bei `mail: true`.
  - [x] **Statuswechsel-Benachrichtigungen:** Auslöser ist derselbe Wechsel, der den Audit-Eintrag schreibt (P0-14): nach `open` oder `auth_expired`, plus eine „wieder erreichbar“-Mail bei Rückkehr nach `healthy`. Empfänger ist ausschließlich der Besitzer des Upstreams (Adresse und Name werden mit der Besitzer-ID aus der Datenbank gelesen, nie aus dem Ereignis; Admins erhalten keine fremden Mails). Inhalt: Upstream-Name, Zustand, `statusReason` und der Link auf `/upstreams/<id>` aus `BASE_URL`; Name und Grund gelten als nicht vertrauenswürdig (Steuer- und Bidi-Zeichen entfernt, URLs, `www.`-Hosts und Adressen entschärft, auf 60 bzw. 200 Zeichen gekürzt, HTML escaped), nie Secrets. Drosselung: höchstens eine Mail je (Upstream, Zustand) pro Fenster (`MAIL_NOTIFY_WINDOW_MIN`, Default 60 Minuten, im Speicher, nach Neustart leer); Flapping erzeugt so höchstens eine Alarm- und eine Erholungsmail je Fenster. Der Versand ist fire-and-forget über eine begrenzte Warteschlange (50 wartende Aufgaben, mehr wird verworfen und ohne Adresse protokolliert) und blockiert oder verändert den Aufrufpfad nie.
  - [x] **Opt-out je Nutzer:** Einstellung `notifyStatusMail` (Tabelle `user_preference`, Default `true`, wird mit dem Nutzer gelöscht), `GET`/`PATCH /api/me/settings` (`{ notifyStatusMail: boolean }`, unbekannte Felder 422). UI: Schalter unter Einstellungen > Benachrichtigungen, nur sichtbar bei `mail: true`. Ein Opt-out verbraucht kein Drosselfenster.
  - P2 danach: E-Mail-Änderung per Link und Konto-Selbstlöschung (Konflikt mit dem Schutz des letzten Admins vorher klären).

- **Intelligentes Routing (Ziel 4), Meta-Tool-Modus** pro Nutzer/Profil: statt aller Tools nur `find_tools(intent)`, `describe_tool`, `invoke_tool` (+ Verwaltungs-Tools). Zweistufig:
  1. **Vorfilter ohne LLM:** Volltext/BM25 über Tool-Name, Beschreibung, Schema, Upstream-Beschreibung; liefert Top-N (Standard 30).
  2. **Auswahl durch das Modell des Aufrufers, per MCP:** Das Gateway hat **kein eigenes LLM, keinen API-Key und keinen Fremdanbieter**. Die Auswahl läuft immer über das Modell des Clients, entweder
     - **a) per MCP-Sampling** (`sampling/createMessage`; in der Revision 2026-07-28 über das MRTR-Muster, siehe P0-12), wenn der Client es unterstützt: Das Gateway schickt Intent + Top-N-Kandidaten (Name, Kurzbeschreibung, Kennung) und erwartet eine Liste von 1–5 Kennungen als strukturierte Antwort; oder
     - **b) als zweistufiger Tool-Dialog**, wenn nicht: `find_tools(intent)` gibt die kompakten Top-N-Kandidaten zurück, das Modell des Clients wählt selbst und holt mit `describe_tool(id)` das volle Schema, dann `invoke_tool(id, args)`. Das ist der erwartete Normalfall, da nicht alle Clients Sampling bieten.
  - [ ] Kein Fallback nötig für „LLM nicht erreichbar": Stufe 1 liefert immer Kandidaten; fehlt Sampling, greift (b) automatisch. Timeout für Sampling 10 s, danach (b).
  - [ ] **Der Aufrufer gilt als nicht vertrauenswürdig (adversarial).** Das Modell des Clients kann per Prompt-Injection aus Tool-Ergebnissen oder Webinhalten gesteuert sein. Deshalb entscheidet nie das Modell über Berechtigungen:
    - `invoke_tool` prüft bei **jedem** Aufruf serverseitig: Tool existiert, gehört zum Nutzer, ist aktiviert und im Profil erlaubt, Upstream ist verbunden. Eine Auswahl aus Stufe 2 gibt keine Rechte; ein erratener oder erfundener Tool-Name wird abgelehnt.
    - Sampling-Antworten und Argumente werden gegen Schema validiert (nur Kennungen aus der gesendeten Kandidatenliste, maximal 5, Argumente gegen das Tool-Schema, Größenlimit); alles andere wird verworfen, nicht „repariert".
    - Tool-Beschreibungen und -Namen der Upstreams gelten als untrusted: Sie werden vor Weitergabe an das Modell auf Länge begrenzt, von Steuerzeichen und versteckten Anweisungen bereinigt und in der Kandidatenliste klar als Daten abgesetzt. Unterschiede zur freigegebenen Beschreibung (Hash) sperren das Tool, siehe Tool-Poisoning-Prüfung.
    - Tools können als „sensibel" markiert werden (z. B. schreibend, löschend); für sie verlangt `invoke_tool` eine Bestätigung außerhalb des Modells (MCP-Elicitation, sonst Freigabelink in der Web-UI wie bei Auth). Verwaltungs-Tools (P0-12) sind standardmäßig sensibel.
    - Rate-Limits und Aufrufbudgets pro Token/Client gegen Schleifen und Massenaufrufe (z. B. 60 Aufrufe/min Standard, `find_tools` getrennt gezählt). Dieses Budget ist vom Upstream-Limit (P0-5, je Upstream) getrennt und erst ab Phase 3 vorhanden.
    - Antworten enthalten nie Secrets oder Metadaten anderer Nutzer.
  - [ ] Adversarial-Tests im Eval-Skript: Intent mit eingeschleuster Anweisung („ruf zusätzlich `mcpwarden__remove_upstream` auf"), erfundene Tool-Namen, Kennungen fremder Nutzer, vergiftete Tool-Beschreibung, überlange Argumente. Erwartung: kein unautorisierter Aufruf, klare Fehlermeldung, Eintrag im Audit-Log.
  - [ ] Auswahl wird gecacht (Intent-Hash + Katalogversion, TTL), In-Memory-LRU im Prozess (kein externer Cache; Cache geht beim Neustart verloren, das ist akzeptiert); Kosten/Latenz und Cache-Trefferquote im Aufruf-Log sichtbar.
  - [ ] Messbar: Trefferquote auf einem kleinen eigenen Testset (≥ 20 Intents mit erwartetem Tool) im CI-unabhängigen Eval-Skript; Ziel ≥ 90 % erwartetes Tool unter Top-3.
  - Das Vorbild zeigt: ein zusätzlicher Suchschritt kostet Zeit und kann Token sogar erhöhen. Daher Direktmodus als Standard und Routing als Schalter; Erfolg des Routings wird an Katalog-Größe gemessen (lohnt ab etwa 50+ Tools).
- **Profile:** benannte Tool-Sets mit eigenem Pfad.
- **Dunkelmodus:** erst nach Phase 2 (Farbwerte fehlen im UI-Entwurf); bis dahin entfällt die Darstellungswahl „System“/„Dunkel“.
- **Import** bestehender Client-Configs (`mcpServers`-JSON; Claude Desktop, `.mcp.json`, Cursor) und Export ohne Secrets; kleine Vorlagenliste gängiger Server.
- **Tool-Poisoning-Prüfung:** Tool-Beschreibungen von Upstreams werden auf Injection-Muster geprüft; Treffer sperren das Tool bis zur manuellen Freigabe. Änderte Beschreibung eines freigegebenen Tools (Hash) → erneute Freigabe („Rug-Pull-Schutz").
- **Aufruf-Log:** Zeit, Client, Tool, Dauer, Status; Parameter standardmäßig nicht gespeichert; Retention 30 Tage.
- **Prompts & Resources proxien.**
- **OpenAPI-Import** → REST-Tools.
- **Hot-Reload** von Upstream-Änderungen ohne bestehende Client-Sessions zu kappen.

### P2 — Architektur offenhalten

- Horizontale Skalierung auf echtem Postgres (MCP-Sessions, Link-Einmaligkeit und Rate-Limit-Zähler aus dem Speicher in die DB verlagern). Ein externer Cache wie Valkey ist **nicht** geplant; falls er je nötig wird, wird er hinter der bestehenden Cache-Funktion `get/set/del` mit TTL nachgerüstet. stdio-Prozesse bleiben pro Instanz, Routing dorthin braucht Sticky Sessions.
- Sampling/Elicitation/Progress-Passthrough (in der Revision 2026-07-28 über MRTR-Zwischenantworten, `InputRequiredResult`).
- Per-Nutzer-Identität an Multitenant-Upstreams (Token-Exchange statt gespeichertem Langzeit-Secret).
- Auf dem optionalen Mailer (P1) aufbauend: E-Mail-Änderung per Link und Konto-Selbstlöschung (Konflikt mit dem Schutz des letzten Admins vorher klären); weitere Benachrichtigungen (z. B. neuer Client).
- Geteilte Upstreams/Teams; verteilte Rate-Limits (über mehrere Instanzen); Freigabe vor Tool-Aufruf (Approval).
- Stärkere stdio-Isolation über den Worker-pro-Nutzer (P0-5) hinaus: eigener Container oder Sandbox je Nutzer, Netzwerk-Egress-Regeln. Nötig, sobald Nutzer dem Betreiber nicht mehr vertraut sind.

## Technische Rahmenbedingungen

- **Stack:** Nuxt 4 (Nitro, Node), shadcn-vue, Drizzle, Better Auth, `@modelcontextprotocol/server` und `@modelcontextprotocol/client` (SDK-Linie v2, ersetzt `@modelcontextprotocol/sdk`). Spec-Revisionen: 2026-07-28 (zustandslos) und 2025-11-25 für ältere Clients.
- **Gateway = MCP-Server nach außen, MCP-Client nach innen.** Pro (Nutzer, Upstream) eine gepoolte Client-Session; `tools/list` gecacht, per `list_changed` invalidiert (2026-Upstreams über `subscriptions/listen`).
- **Single-Instance:** Sessions und stdio-Prozesse liegen im Speicher einer Instanz; horizontales Skalieren ist in v1 Nicht-Ziel. PGlite ist an einen Prozess gebunden; echtes Postgres entlastet die Datenbank bei größeren Instanzen, die Prozess-Zustände bleiben aber bis P2 pro Instanz.
- **Zuständigkeit Frontend/Backend:** Das Frontend übernimmt alle `app/**`-Dateien (Seiten, Layouts, Komponenten, auch die in den Backend-Plänen genannten Login-, Consent-, Token- und Admin-Seiten). Die Backend-Phasen liefern nur API-Routen, Tests und Beiträge zu `shared/api-types.ts`. Navigationstexte folgen dem UI-Entwurf („Clients“ statt „Verbindungen“), API-Pfade bleiben.
- **UI-Grundsätze:** Schriften werden lokal ausgeliefert (kein externer Font-Abruf auf einer self-hosted Instanz). Statusfarben nie ohne Textlabel (P0-14). Pfade wie der stdio-Arbeitsordner kommen vom Server, das UI baut sie nicht. Auto-Refresh ist reines Polling.
- **Streaming:** Reverse-Proxy darf Streamable-HTTP/SSE nicht puffern (Hinweis in Doku, Heartbeat-Events gegen Idle-Timeouts).
- **Sicherheitsmodell öffentlich:** Risiko Nr. 1 ist stdio (= Codeausführung auf dem Host). Daher Admin-Freigabe und Non-Root; Risiko Nr. 2 SSRF (P0-9); Risiko Nr. 3 manipulierte Tool-Beschreibungen (P1).
- **Umgang mit dem Vorbild (`MikkoParkkola/mcp-gateway`, Rust):** Den Quellcode dürfen wir lesen und als Inspiration für Konzepte, Datenfluss und Randfälle nutzen. Es wird **kein Code kopiert oder 1:1 nach TypeScript übersetzt**; Implementierung entsteht eigenständig aus Spec und MCP-Spezifikation. Grund: Die Lizenz ist laut `LICENSES.md` PolyForm-Noncommercial 1.0.0 für alle eigenen Dateien (ältere Releases hatten teils MIT-Header, aktuell gilt das nicht mehr), kommerzielle Nutzung braucht eine separate Lizenz. Übernommene Ideen werden im Code nicht als Kopie gekennzeichnet, aber in `docs/inspirations.md` als Quelle der Idee festgehalten (Datei, Konzept, was wir anders lösen).

## Erfolgskriterien

**Leading (1–2 Wochen)**
- Alle meine Clients nutzen genau **einen** Eintrag, alte Einzeleinträge entfernt (100 %).
- Client-Erstverbindung per OAuth ≤ 60 s und ohne manuelles Token-Kopieren in ≥ 2 verschiedenen Clients.
- Neuer Upstream bis nutzbar ≤ 2 min.
- Gateway-Overhead pro `tools/call` p95 ≤ 50 ms; `tools/list` aus Cache ≤ 200 ms bei 10 Upstreams.
- 0 Treffer in Isolationstest (Nutzer B erreicht Daten von A) und SSRF-Test (Metadaten-IP, private IPs blockiert).

**Lagging (1–3 Monate)**
- 0 Secrets in Client-Configs.
- Token-Rotation eines Upstreams: 1 Änderung statt n.
- Gemessene `tools/list`-Größe pro Client sinkt gegenüber vorher.
- Verfügbarkeit des Containers ≥ 99 % (Selbstbeobachtung über Healthcheck).

## Offene Fragen

**Blockierend**
1. ~~LLM für das Routing~~ **Entschieden:** Modell des Aufrufers per MCP, adversarial behandelt (P1 Routing). Kein Anbieter, kein Key im Gateway. Offen und nicht blockierend: Welche der Ziel-Clients unterstützen Sampling? Das bestimmt, wie oft der Tool-Dialog (b) der Normalfall ist. — *Engineering, Messung in Phase 3*
1a. ~~Upstream-OAuth-Redirect ohne DCR~~ **Entschieden:** out of scope, bis es jemand braucht (siehe Nicht-Ziele).
2. ~~Wer sind die Endnutzer?~~ **Entschieden:** erst ich, später Team/Freunde → Mehrnutzerfähigkeit (Einladung, Isolation, Nutzersperre) bleibt P0, geteilte Upstreams P2.
3. ~~stdio auf öffentlichem Host~~ **Entschieden:** Ein Node-Worker pro Nutzer kapselt dessen stdio-Prozesse (P0-5). Freigabe für Nicht-Admins bleibt eine Admin-Entscheidung pro Nutzer, weil Netzwerk und Kernel geteilt sind. **UID-Wechsel per Capabilities entschieden:** Container startet mit `cap_drop: ALL` und `cap_add: SETUID, SETGID, CHOWN` (CHOWN nur zum Anlegen der Nutzerverzeichnisse). Technisches Detail zur Umsetzung: Die Web-App läuft unprivilegiert; ein kleiner separater Supervisor-Prozess hält die Capabilities, startet die Worker unter der Nutzer-UID und nimmt nur Befehle der Web-App über einen Unix-Socket entgegen. So hat der Prozess, der HTTP-Anfragen aus dem Internet bedient, nie diese Rechte. Ist der Container ohne die Capabilities gestartet, schaltet sich stdio für Nicht-Admins ab (siehe P0-5). — *erledigt, Umsetzung beim Dockerfile-Entwurf*
4. ~~Better-Auth-Spike~~ **Entschieden:** Better Auth trägt OAuth für MCP-Clients, in der Praxis mit mehreren Tools getestet. Kein eigener OAuth-Layer, kein Spike. **Abnahme P0-2:** Claude Code und Cursor; Claude Desktop/Web bei der ersten öffentlichen Instanz.

**Nicht blockierend**
4a. ~~Valkey~~ **Entschieden:** raus. Cache für Tool-Listen und Routing-Ergebnisse ist In-Memory.
5. Domain/Hosting-Ort und Reverse-Proxy (Streaming-Puffer, Timeouts)? — *Christian*
6. Idle-Timeout stdio (Vorschlag 10 min), Limit gleichzeitiger Prozesse pro Nutzer (Vorschlag 5)? — *Engineering*
7. Soll der Aufruf-Log Parameter/Ergebnisse speichern können (Debugging vs. Datenschutz)? — *Christian*
8. ~~Dynamic Client Registration~~ **Entschieden:** Admin-Einstellung mit Allowlist gängiger Tools, unbekannte Clients bekommen eine Warnung (P0-2). Upstreams ohne DCR sind out of scope, bis jemand sie braucht; die Link-Seite meldet dann „nicht unterstützt".
9. ~~Sollen neu entdeckte Upstream-Tools standardmäßig aktiv sein?~~ **Entschieden (2026-11-04): ja, bis die Tool-Poisoning-Prüfung (P1) existiert.** Ursprüngliche Frage: Sollen neu entdeckte Upstream-Tools standardmäßig aktiv sein? Die Spec schweigt (P0-7); der Review empfiehlt „ja“, bis die Tool-Poisoning-Prüfung (P1) existiert. — *Christian*
10. ~~Phase-1-Defaults~~ **Entschieden (2026-11-04): übernommen.** Vorschlag aus dem Review: Phase-1-Defaults für stdio übernehmen (Frage 6: Idle 10 min, max. 5 Kindprozesse). — *Christian*
11. ~~UI-Abgleich (acht Fragen)~~ **Entschieden (2026-11-04):** Frontend besitzt `app/**`; Token-Link-Einladung; keine Mailfunktionen und keine Selbstlöschung; Dashboard und Audit-Lesen ab Phase 1; Admin-Scope im Consent abwählbar; Audit nach Nutzer, Admin zusätzlich Instanzereignisse; Tags/Gerätenamen gestrichen, „Alle testen“ später, Heatmap nur mit `health-history`; Dunkelmodus nach Phase 2. Einarbeitung siehe „Änderungen ggü. v0.4“.
12. ~~Mailversand~~ **Entschieden (2026-11-05): optional statt Nicht-Ziel.** Ohne `SMTP_URL` bleibt alles wie bisher (Link-Einladungen, kein Mailserver nötig). Reihenfolge: Passwort-Reset (gebaut) → Einladungs- und Statusmails mit Opt-out (nach Phase 1) → E-Mail-Änderung und Selbstlöschung (P2). Ersetzt die Teilentscheidung „keine Mailfunktionen“ aus Frage 11.

## Phasen

- **Phase 0a (Fundament, zuerst):** Nuxt-4-Gerüst, Drizzle + PGlite (P0-11), Better-Auth-Adapter (Postgres) und dessen generiertes Schema inkl. `admin()`-Plugin (`role`, `banned`; Migration 0000), Migrationen beim Start, Master-Key-Prüfung. Better Auth speichert Nutzer, Sessions, OAuth-Clients, Codes und Tokens in der DB; ohne diese Schicht läuft weder Login noch OAuth. Fertig, wenn Registrierung/Login (erster Nutzer = Admin, atomar) gegen PGlite funktionieren, ein Neustart die Daten behält und derselbe Testsatz mit `DATABASE_URL` auf einen Postgres-Container ebenfalls grün ist. Der Umstiegstest PGlite→Postgres (Dump/Import) gehört **nicht** zur Abnahme, sondern zu Phase 1.
- **Phase 0b (OAuth-Provider, braucht 0a):** Better Auth als OAuth-Provider für `/mcp` einbinden (P0-2, Scope `mcp:tools`, Widerruf pro Request) und mit Claude Code und Cursor verbinden; P0-3 (PAT) wird hier vorgezogen. Kein Spike mehr nötig, da bereits getestet; Phase dient als erster vertikaler Durchstich: Login → Consent → Token → `tools/list` mit einem Dummy-Upstream.
- **Phase 1 (Kern):** P0-1 bis P0-7, P0-9 bis P0-11 und P0-16 (Dashboard ohne KPIs, Audit-Lesen). Meilenstein 1.1 enthält die Nutzerverwaltung aus P0-4 (Einladungslinks, Nutzerliste, Sperren/Entsperren, Löschen, Limits je Nutzer). Vom Resilienz- und Statistikteil: Minimum von P0-14 (Timeouts, einfacher Breaker, Status, `/healthz`, `/readyz`, Graceful Shutdown) und P0-15 (Schreibpfad der Messdaten). Dazu der Umstiegstest PGlite→Postgres (P0-11). Nach Abschluss alle Clients umstellen.
- **Phase 2 (Selbstbedienung):** P0-12 Verwaltungs-Tools + Link-Flow, P0-13 Upstream-OAuth, P0-8 REST-Tools; Rest von P0-14 (aktiver Ping, Idempotent-Retry; `health-history`, falls Verfügbarkeit/Heatmap gebaut werden) und P0-15 (Perzentile, Rollups, Statistik-Seite, `get_stats`); Dashboard-KPIs und Diagramme; Admin-Scope im Consent (zwei Schalter). Danach Dunkelmodus.
- **Phase 3 (Routing):** Keyword-Vorfilter + Auswahl durch den Aufrufer (Sampling oder Tool-Dialog) mit serverseitiger Prüfung, Eval-Skript inkl. Adversarial-Tests, Aufruf-Log, Import, Profile.
- **Phase 4:** Tool-Poisoning-Prüfung, Prompts/Resources.

Keine harten Deadlines.
