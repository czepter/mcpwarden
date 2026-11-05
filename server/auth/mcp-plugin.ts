/**
 * Better-Auth als OAuth-Provider fuer /mcp: `jwt()` + `mcp()` und die Request-Haken, die daraus eine
 * sichere Konfiguration machen. Befunde des Spikes (Plan 0b, Aufgabe 1; @better-auth/mcp 1.7.17,
 * @better-auth/oauth-provider 1.7.17, per Test belegt in tests/integration/oauth/):
 *
 * Pfade und Issuer
 *  - Issuer = `<BASE_URL>/api/auth` (basePath bleibt, 0a). Endpunkte: `/api/auth/oauth2/{authorize,token,register,
 *    consent,revoke,introspect,public-client}`, JWKS `/api/auth/jwks`.
 *  - `onRequest` des Plugins beantwortet Well-known-Pfade unabhaengig vom basePath: `/.well-known/oauth-protected-resource`
 *    (+ `/mcp`) und `/.well-known/oauth-authorization-server/api/auth` (RFC 8414 Pfad-Einfuegung). Ohne Pfad liefert
 *    das Plugin 404; die Nitro-Route (routes/.well-known/[...path].ts) schreibt die Rootvarianten darauf um.
 *
 * Token
 *  - Mit `resource`: JWT (`typ at+jwt`, EdDSA), Claims `sub`, `aud` = [resource, <issuer>/oauth2/userinfo],
 *    `client_id`, `azp`, `scope`, `sid`, `iss`, `iat`, `exp`, `jti`. Ohne `resource`: opakes Token (nicht per JWKS pruefbar).
 *    Entscheidung: `oauthRequestRewrite` setzt bei /oauth2/authorize und /oauth2/token die Default-Resource ein,
 *    jedes Token ist also ein JWT mit `aud` = `<BASE_URL>/mcp`. Opake Tokens lehnt der Guard als 401 ab.
 *  - Refresh-Token: Tabelle `oauth_refresh_token` (Spalten `revoked`, `expires_at`, `user_id`, `client_id`);
 *    Widerruf per RFC 7009 setzt `revoked`. Basis des Guards (Aufgabe 6).
 *
 * offline_access (R15)
 *  - Das Plugin ergaenzt `offline_access` nicht von selbst (Clients, die nur `mcp:tools` anfordern, bekommen sonst
 *    keinen Refresh-Token). Ein `hooks.before` auf /oauth2/authorize ergaenzt `openid offline_access mcp:tools` in der
 *    Query vor der Signatur: es muss kein Client abgelehnt werden, und die Zustimmung bietet immer alle drei Scopes an.
 *
 * Consent-Teilmenge
 *  - Das Plugin akzeptiert beim Consent (`scope` im Body) jede Teilmenge der urspruenglich angeforderten Scopes,
 *    auch ohne `mcp:tools`. `consentGuard` lehnt Teilmengen ohne Pflicht-Scopes ab (Grundlage fuer Phase 2:
 *    `mcpwarden:admin` abwaehlbar, solange es als `required:false` angeboten wird).
 *
 * DCR
 *  - `clientPrivileges` wird nur fuer sitzungsgestuetzte Registrierungen ausgewertet, NICHT fuer anonyme DCR
 *    (authorize-*.mjs, registerEndpoint: `if (session) assertClientPrivileges`). Das Policy-Gate ist daher ein
 *    `hooks.before` auf /oauth2/register (dcr-hook.ts); es sieht auch Direktaufrufe der Plugin-Route.
 *  - Unbekannte Scopes lehnt das Plugin selbst ab (`invalid_scope`), http-Redirects ausserhalb Loopback ebenfalls.
 *  - Eigene Rate-Limits des Plugins (register 5/min je IP, token 20/min, authorize 30/min) greifen nur bei aktivem
 *    Better-Auth-Rate-Limit.
 *
 * mcp() beim Start
 *  - Schreibt die Resource (`oauth_resource`, Zeile `<BASE_URL>/mcp`) beim ersten Zugriff in die DB (seedResources);
 *    mit dem memoisierten getAuth() aus 0a unproblematisch (laeuft nach der Migration).
 *
 * Uebergabe Frontend (Login/Consent; das Frontend baut `app/**`, 0b liefert nur die API)
 *  - `GET /api/auth/oauth2/authorize?...` leitet ohne Session auf `loginPage` (`/login?<query>`), mit Session auf
 *    `consentPage` (`/consent?<query>`). Die Query enthaelt die Authorize-Parameter plus `exp`, `sig`, `ba_iat`,
 *    `ba_param`; sie ist signiert und muss UNVERAENDERT an die Seiten und durch den Login-Redirect (Auth-Middleware
 *    auf `/login`) erhalten bleiben (kein Umsortieren, kein Entfernen von Parametern). Fetch-Clients ohne
 *    `Accept: text/html` bekommen statt 302 den Body `{ redirect: true, url }`.
 *  - Nach dem Login ruft die Login-Seite `GET /api/auth/oauth2/authorize` mit derselben Query erneut auf bzw. folgt
 *    dem Redirect weiter (Clientplugin `oauthProviderClient()`: der Sign-in-Aufruf haengt `oauth_query` an und
 *    leitet selbst weiter, wenn die Login-Query vorhanden ist).
 *  - Consent-Seite: `GET /api/oauth/consent-info?<unveraenderte Query>` liefert `ConsentInfo`; Zustimmung per
 *    `POST /api/auth/oauth2/consent { accept: boolean, scope?: 'openid offline_access mcp:tools', oauth_query: <Query> }`
 *    (Clientplugin: `authClient.oauth2.consent`). Antwort `{ redirect: true, url }`: der Browser folgt `url`
 *    (Redirect-URI des Clients mit `code`, `state`, `iss`; bei Ablehnung `error=access_denied`).
 *    `scope` weglassen = alle angeforderten (immer die drei Pflicht-Scopes); eine Teilmenge ohne Pflicht-Scope
 *    liefert 400.
 */
import { mcp } from '@better-auth/mcp'
import { APIError } from 'better-auth/api'
import { jwt } from 'better-auth/plugins'
import { buildConsentScopes, validateAcceptedScopes } from './consent'
import { ACCESS_TOKEN_TTL_SECONDS, parseScopeString, REFRESH_TOKEN_TTL_SECONDS, SCOPES_SUPPORTED } from './scopes'

export function mcpResource(baseUrl: string): string {
  return new URL('/mcp', baseUrl).href
}

export function mcpPlugins(baseUrl: string) {
  return [
    jwt(),
    mcp({
      loginPage: '/login',
      consentPage: '/consent',
      resource: mcpResource(baseUrl),
      scopes: [...SCOPES_SUPPORTED],
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
      // Nur Nutzer-Grants: client_credentials liefe ohne Nutzer und waere ueber anonyme DCR erreichbar.
      grantTypes: ['authorization_code', 'refresh_token'],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'infer',
    }),
  ] as const
}

type Rewrite = { query?: Record<string, unknown>, body?: Record<string, unknown> }

/**
 * Erzwingt Pflicht-Scopes und Default-Resource, bevor das Plugin den Request sieht. Reine Funktion.
 * authorize: Scopes + Resource in Query (GET) bzw. Body (POST); token: Resource im Body.
 */
export function oauthRequestRewrite(path: string, query: unknown, body: unknown, resource: string): Rewrite | undefined {
  const withDefaults = (src: unknown, scoped: boolean) => {
    const o = { ...((src ?? {}) as Record<string, unknown>) }
    if (scoped) o.scope = [...new Set([...parseScopeString(typeof o.scope === 'string' ? o.scope : ''), ...SCOPES_SUPPORTED])].join(' ')
    if (o.resource === undefined || o.resource === '') o.resource = resource
    return o
  }
  if (path === '/oauth2/authorize') {
    return query && Object.keys(query).length ? { query: withDefaults(query, true) } : { body: withDefaults(body, true) }
  }
  if (path === '/oauth2/token') return { body: withDefaults(body, false) }
  return undefined
}

/** Lehnt eine Zustimmung mit Teilmenge ab, der Pflicht-Scopes fehlen. `scope` fehlt = alle angeforderten. */
export function consentGuard(path: string, body: unknown): void {
  if (path !== '/oauth2/consent') return
  const b = (body ?? {}) as { accept?: unknown, scope?: unknown }
  if (b.accept !== true || b.scope === undefined) return
  const accepted = typeof b.scope === 'string' ? parseScopeString(b.scope) : [null]
  const r = validateAcceptedScopes(accepted, buildConsentScopes([]))
  if (!r.ok) throw new APIError('BAD_REQUEST', { error: 'invalid_scope', error_description: r.reason })
}
