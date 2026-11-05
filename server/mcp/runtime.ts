/**
 * Verdrahtung des /mcp-Gateways (Plan 0b, Aufgaben 6 bis 8): Token-Verifizierung gegen die JWKS des
 * eigenen Providers (in-process, ohne HTTP), Drizzle-AccessStore, Dummy-Upstream und Stream-Steuerung.
 * Spike-Entscheidung Aufgabe 6: `verifyJwsAccessToken` aus `better-auth/oauth2` (Signatur, Issuer, Audience,
 * Ablauf) mit eigener Antwort aus errors.ts, weil der Guard vor dem MCP-Handler zusaetzliche Pruefungen braucht
 * (`requireMcpAuth` bietet dafuer keinen Haken).
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
import type { ToolSource } from './upstream-port'

type Gateway = ReturnType<typeof createGateway>
const g = globalThis as typeof globalThis & { __mcpwGateway?: Promise<Gateway> }

/**
 * Die echte Tool-Quelle ist das Gateway (Upstreams des Nutzers). Der Dummy-Upstream aus 0b bleibt nur für die
 * Integrationstests erreichbar (`MCPW_DUMMY_UPSTREAM=1`), nie im Produktionsbetrieb.
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
      // DPoP-gebundene Tokens (cnf) nicht als Bearer akzeptieren.
      if (p.cnf !== undefined || typeof p.sub !== 'string' || typeof p.exp !== 'number') return null
      const clientId = typeof p.client_id === 'string' ? p.client_id : typeof p.azp === 'string' ? p.azp : null
      if (!clientId) return null
      return {
        userId: p.sub, clientId, scopes: parseScopeString(typeof p.scope === 'string' ? p.scope : ''),
        audience: Array.isArray(p.aud) ? p.aud : p.aud ? [p.aud] : [], expiresAt: p.exp, jti: typeof p.jti === 'string' ? p.jti : undefined,
      }
    } catch {
      return null // Signatur, Issuer, Audience, Ablauf oder opakes Token: einheitlich ungueltig
    }
  }

  const authenticate = createAccessGuard({
    resource, resourceMetadataUrl: resourceMetadataUrl(cfg.baseUrl), verifyAccessToken, store: createDrizzleAccessStore(db),
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
