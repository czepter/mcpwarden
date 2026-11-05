# mcpwarden messaging kit

Status: draft, written against `docs/spec.md` v0.5 and the UI mockups. Everything is in English.
Rule for all copy: only claim what the spec lists, and name the phase when a feature is not in the core.

## Positioning

mcpwarden is a self-hosted gateway for the Model Context Protocol. Clients connect to one URL and sign in with OAuth. Upstream servers, secrets and tool lists live behind it.

Audience: developers who use several coding tools (Claude Code, Cursor, Claude Desktop) on several devices, then small teams and friends who share an instance.

## Taglines

- One URL for every MCP server you use.
- Connect once. Add servers behind it.
- Your MCP servers, one door.
- Stop copying tokens between clients.

## Elevator pitches

**20 words**
mcpwarden is a self-hosted MCP gateway. Sign in once from any client, and manage servers and secrets in one place.

**50 words**
Every coding tool keeps its own list of MCP servers and its own copy of your tokens. mcpwarden replaces that with one URL. You sign in with OAuth, and your servers, encrypted secrets and tool switches live in a gateway you host. Add a server once and every client has it.

## Message pillars

| Pillar | Proof from the spec | Phase |
| --- | --- | --- |
| One connection per client | Single `/mcp` URL, OAuth 2.1 with PKCE, dynamic client registration | Core |
| Secrets stay put | AES-GCM, per-user derived key, no secrets in client configs, replace-only in the UI | Core |
| Safe to expose | Revocation checked on every request, SSRF guard, per-user stdio workers, admin approval for stdio | Core |
| Resilient | Timeouts, circuit breaker, health status, `/healthz` and `/readyz` | Core |
| Manage from chat | `add_upstream`, `get_auth_link`; secrets only via a single-use 15 minute link | Phase 2 |
| Slim context | Per-tool switches now, meta-tools (`find_tools`, `describe_tool`, `invoke_tool`) later | Core / Phase 3 |

## Social posts

1. Every MCP client keeps its own server list and its own copy of your tokens. Rotate one key and you edit it three times. mcpwarden is a self-hosted gateway that gives every client one URL instead. In development.
2. Example: 3 clients with 4 servers each is 12 config entries and 12 places for secrets. Behind a gateway it is 3 entries and 0 secrets in client configs.
3. "Add the Sentry MCP." Your coding tool creates the upstream and hands you a link. The token goes into the web UI, never into the chat. That is the Phase 2 flow in mcpwarden.
4. A gateway that holds your keys should expect strangers. mcpwarden checks revocation on every request, blocks SSRF targets including raw IP literals, and keeps stdio servers behind an admin approval.
5. Honest note on context size: a search step can cost more than it saves. mcpwarden keeps direct mode as the default and offers meta-tools as a switch for setups with roughly 50 tools or more.

## README opening

> **mcpwarden** is a self-hosted MCP gateway. Add one URL to Claude Code, Cursor or Claude Desktop, sign in with OAuth, and reach every upstream server you configured: stdio, Streamable HTTP or REST. Secrets are encrypted in the gateway, tools can be switched off one by one, and revoking a client or token takes effect on the next request.

## Claims to avoid until they are true

- "Production ready" or any uptime figure. The spec only sets targets.
- "Works with Claude Desktop and Claude web". They are verified with the first public instance.
- "Team collaboration". Shared upstreams and roles are out of scope for version one.
- "Saves tokens" as a blanket statement. The spec itself warns routing can increase them; measure first.
- "Sandboxed". stdio isolation separates files, memory and crashes only. Kernel and network are shared.
- Any testimonial, customer count or benchmark. None exist.

## Where the mockups and the spec differ

The copy follows the spec. The mockups still show these older items:

- "Online / connected since" → spec uses **Active** (call in the last 5 minutes) and **Inactive**.
- "Tags" filter and "Alle testen" button on the upstream list → dropped or deferred.
- Consent scope `mcp` → spec name is `mcp:tools`.
- Mockup text is German; the marketing page uses English labels.
