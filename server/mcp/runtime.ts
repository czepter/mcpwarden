/**
 * Wiring of the /mcp gateway (plan 0b, tasks 6 to 8): token verification against the JWKS of the
 * own provider (in-process, without HTTP), Drizzle AccessStore, dummy upstream and stream control.
 * Spike decision task 6: `verifyJwsAccessToken` from `better-auth/oauth2` (signature, issuer, audience,
 * expiry) with our own response from errors.ts, because the guard needs additional checks before the MCP handler
 * (`requireMcpAuth` offers no hook for that).
 */
import { verifyJwsAccessToken } from 'better-auth/oauth2'
import { createDrizzleAccessStore } from '../auth/access-store'
import { createAccessGuard, type VerifiedAccessToken } from '../auth/access-guard'
import { getAuth } from '../auth'
import { parseScopeString } from '../auth/scopes'
import { getDb } from '../db'
import { getConfig } from '../utils/config'
import { resourceMetadataUrl, resourceUrl } from './discovery'
import { createDummyUpstream } from './dummy-upstream'
import { createGateway } from './handler'
import { bindStreamControl, notifyToolsChanged } from './notify'
import { getRuntime } from '../gateway/runtime'
import { getMailer } from '../mail'
import { createNewClientNotifier } from '../mail/notify'
import { oauthClient } from '../db/schema/auth'
import { eq } from 'drizzle-orm'
import type { ToolSource } from './upstream-port'

type Gateway = ReturnType<typeof createGateway>
const g = globalThis as typeof globalThis & { __mcpwGateway?: Promise<Gateway> }

/**
 * The real tool source is the gateway (the user's upstreams). The dummy upstream from 0b stays reachable only for the
 * integration tests (`MCPW_DUMMY_UPSTREAM=1`), never in production.
 */
async function toolSource(): Promise<ToolSource> {
  const real = (await getRuntime()).gw.toolSource
  if (process.env.MCPW_DUMMY_UPSTREAM !== '1') return real
  const dummy = createDummyUpstream({ notify: notifyToolsChanged })
  return {
    listTools: async ctx => [...await dummy.listTools(ctx), ...await real.listTools(ctx)],
    callTool: (ctx, name, args, o) => (name.startsWith('dummy__') ? dummy.callTool(ctx, name, args, o) : real.callTool(ctx, name, args, o)),
  }
}

async function create(): Promise<Gateway> {
  const cfg = getConfig()
  const [auth, db] = await Promise.all([getAuth(), getDb()])
  const resource = resourceUrl(cfg.baseUrl)
  const issuer = `${cfg.baseUrl.origin}/api/auth`
  const jwksCacheKey = {}

  async function verifyAccessToken(token: string): Promise<VerifiedAccessToken | null> {
    try {
      const p = await verifyJwsAccessToken(token, {
        jwksFetch: async () => await auth.api.getJwks() as never,
        jwksCacheKey,
        verifyOptions: { issuer, audience: resource },
      })
      // Do not accept DPoP-bound tokens (cnf) as Bearer.
      if (p.cnf !== undefined || typeof p.sub !== 'string' || typeof p.exp !== 'number') return null
      const clientId = typeof p.client_id === 'string' ? p.client_id : typeof p.azp === 'string' ? p.azp : null
      if (!clientId) return null
      return {
        userId: p.sub, clientId, scopes: parseScopeString(typeof p.scope === 'string' ? p.scope : ''),
        audience: Array.isArray(p.aud) ? p.aud : p.aud ? [p.aud] : [], expiresAt: p.exp, jti: typeof p.jti === 'string' ? p.jti : undefined,
      }
    } catch {
      return null // signature, issuer, audience, expiry or opaque token: uniformly invalid
    }
  }

  // "New client connected" mail: fires on the first use row of (user, client); opt-out and address come from the DB in the background.
  const newClientMail = createNewClientNotifier({
    mailer: getMailer(),
    baseUrl: cfg.baseUrl,
    lookup: async (userId, clientId) => {
      const rt = await getRuntime()
      const [owner, prefs, [client]] = await Promise.all([rt.repo.getUserLite(userId), rt.repo.getPrefs(userId), db.select({ name: oauthClient.name }).from(oauthClient).where(eq(oauthClient.clientId, clientId))])
      if (!owner || owner.banned) return null
      return { email: owner.email, notify: prefs.notifyNewClient, clientName: client?.name ?? null }
    },
  })
  const authenticate = createAccessGuard({
    resource, resourceMetadataUrl: resourceMetadataUrl(cfg.baseUrl), verifyAccessToken, store: createDrizzleAccessStore(db, { onFirstConnection: (u, c) => { newClientMail.notify(u, c) } }),
    onError: e => console.error('[mcpwarden] access check failed:', e instanceof Error ? e.message : 'unknown'),
  })
  const gateway: Gateway = createGateway({
    authenticate,
    tools: await toolSource(),
    cfg: { baseUrl: cfg.baseUrl, allowedOrigins: cfg.allowedOrigins },
  })
  bindStreamControl(gateway)
  return gateway
}

export function getGateway(): Promise<Gateway> {
  return (g.__mcpwGateway ??= create())
}

export async function closeGateway(): Promise<void> {
  const p = g.__mcpwGateway
  g.__mcpwGateway = undefined
  bindStreamControl(undefined)
  await (await p?.catch(() => undefined))?.close()
}
