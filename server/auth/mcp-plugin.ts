/**
 * Better Auth as the OAuth provider for /mcp: `jwt()` + `mcp()` and the request hooks that turn it into a
 * secure configuration. Spike findings (plan 0b, task 1; @better-auth/mcp 1.7.17,
 * @better-auth/oauth-provider 1.7.17, verified by tests in tests/integration/oauth/):
 *
 * Paths and issuer
 *  - Issuer = `<BASE_URL>/api/auth` (basePath stays, 0a). Endpoints: `/api/auth/oauth2/{authorize,token,register,
 *    consent,revoke,introspect,public-client}`, JWKS `/api/auth/jwks`.
 *  - The plugin's `onRequest` answers well-known paths independently of the basePath: `/.well-known/oauth-protected-resource`
 *    (+ `/mcp`) and `/.well-known/oauth-authorization-server/api/auth` (RFC 8414 path insertion). Without a path
 *    the plugin returns 404; the Nitro route (routes/.well-known/[...path].ts) rewrites the root variants to it.
 *
 * Token
 *  - With `resource`: JWT (`typ at+jwt`, EdDSA), claims `sub`, `aud` = [resource, <issuer>/oauth2/userinfo],
 *    `client_id`, `azp`, `scope`, `sid`, `iss`, `iat`, `exp`, `jti`. Without `resource`: opaque token (not verifiable via JWKS).
 *    Decision: `oauthRequestRewrite` inserts the default resource on /oauth2/authorize and /oauth2/token,
 *    so every token is a JWT with `aud` = `<BASE_URL>/mcp`. The guard rejects opaque tokens with 401.
 *  - Refresh token: table `oauth_refresh_token` (columns `revoked`, `expires_at`, `user_id`, `client_id`);
 *    revocation per RFC 7009 sets `revoked`. Basis of the guard (task 6).
 *
 * offline_access (R15)
 *  - The plugin does not add `offline_access` on its own (clients that request only `mcp:tools` would otherwise get
 *    no refresh token). A `hooks.before` on /oauth2/authorize adds `openid offline_access mcp:tools` to the
 *    query before the signature: no client has to be rejected, and the consent always offers all three scopes.
 *
 * Consent subset
 *  - On consent (`scope` in the body) the plugin accepts any subset of the originally requested scopes,
 *    even without `mcp:tools`. `consentGuard` rejects subsets without the required scopes (basis for phase 2:
 *    `mcpwarden:admin` can be deselected as long as it is offered as `required:false`).
 *
 * DCR
 *  - `clientPrivileges` is evaluated only for session-backed registrations, NOT for anonymous DCR
 *    (authorize-*.mjs, registerEndpoint: `if (session) assertClientPrivileges`). The policy gate is therefore a
 *    `hooks.before` on /oauth2/register (dcr-hook.ts); it also sees direct calls of the plugin route.
 *  - The plugin itself rejects unknown scopes (`invalid_scope`), and also http redirects outside loopback.
 *  - The plugin's own rate limits (register 5/min per IP, token 20/min, authorize 30/min) apply only when the
 *    Better Auth rate limit is active.
 *
 * mcp() at startup
 *  - Writes the resource (`oauth_resource`, row `<BASE_URL>/mcp`) to the DB on first access (seedResources);
 *    unproblematic with the memoized getAuth() from 0a (runs after the migration).
 *
 * Frontend handover (login/consent; the frontend builds `app/**`, 0b delivers only the API)
 *  - `GET /api/auth/oauth2/authorize?...` redirects to `loginPage` (`/login?<query>`) without a session, and to
 *    `consentPage` (`/consent?<query>`) with a session. The query contains the authorize parameters plus `exp`, `sig`, `ba_iat`,
 *    `ba_param`; it is signed and must be preserved UNCHANGED through the pages and the login redirect (auth middleware
 *    on `/login`) (no reordering, no removing of parameters). Fetch clients without
 *    `Accept: text/html` get the body `{ redirect: true, url }` instead of 302.
 *  - After login the login page calls `GET /api/auth/oauth2/authorize` again with the same query, or follows
 *    the redirect (client plugin `oauthProviderClient()`: the sign-in call appends `oauth_query` and
 *    redirects on its own if the login query is present).
 *  - Consent page: `GET /api/oauth/consent-info?<unchanged query>` returns `ConsentInfo`; consent via
 *    `POST /api/auth/oauth2/consent { accept: boolean, scope?: 'openid offline_access mcp:tools', oauth_query: <Query> }`
 *    (client plugin: `authClient.oauth2.consent`). Response `{ redirect: true, url }`: the browser follows `url`
 *    (the client's redirect URI with `code`, `state`, `iss`; on denial `error=access_denied`).
 *    Omitting `scope` = all requested (always the three required scopes); a subset without a required scope
 *    returns 400.
 */
import { mcp } from '@better-auth/mcp'
import { oauthDeviceAuthorization } from '@better-auth/oauth-provider'
import { APIError } from 'better-auth/api'
import { jwt } from 'better-auth/plugins'
import { buildConsentScopes, validateAcceptedScopes } from './consent'
import { assertDeviceClient, DEVICE_CODE_TTL, DEVICE_POLL_INTERVAL, USER_CODE_LENGTH } from './device'
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
      // User grants only: client_credentials would run without a user and be reachable via anonymous DCR.
      grantTypes: ['authorization_code', 'refresh_token'],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: 'infer',
    }),
    // RFC 8628 for headless sessions, first-party client only (server/auth/device.ts). The verification page is the UI (`/device`),
    // not the API endpoint of the same name below the base path, hence an absolute URL.
    oauthDeviceAuthorization({
      expiresIn: DEVICE_CODE_TTL,
      interval: DEVICE_POLL_INTERVAL,
      userCodeLength: USER_CODE_LENGTH,
      verificationUri: new URL('/device', baseUrl).href,
      onDeviceAuthRequest: assertDeviceClient,
    }),
  ] as const
}

type Rewrite = { query?: Record<string, unknown>, body?: Record<string, unknown> }

/**
 * Enforces required scopes and the default resource before the plugin sees the request. Pure function.
 * authorize: scopes + resource in the query (GET) or body (POST); token: resource in the body.
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

/** Rejects a consent with a subset that lacks the required scopes. Missing `scope` = all requested. */
export function consentGuard(path: string, body: unknown): void {
  if (path !== '/oauth2/consent') return
  const b = (body ?? {}) as { accept?: unknown, scope?: unknown }
  if (b.accept !== true || b.scope === undefined) return
  const accepted = typeof b.scope === 'string' ? parseScopeString(b.scope) : [null]
  const r = validateAcceptedScopes(accepted, buildConsentScopes([]))
  if (!r.ok) throw new APIError('BAD_REQUEST', { error: 'invalid_scope', error_description: r.reason })
}
