import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { eq } from 'drizzle-orm'
import type { ConsentInfo } from '#shared/api-types'
import { buildConsentInfo } from '../../auth/consent'
import { listAllowlist } from '../../auth/dcr-store'
import { parseScopeString } from '../../auth/scopes'
import { getDb } from '../../db'
import { oauthClient } from '../../db/schema/auth'
import { oauthClientMeta } from '../../db/schema/mcp'
import { apiError, noStore } from '../../utils/api'
import { getConfig } from '../../utils/config'
import { requireUser } from '../../utils/session'

// Daten fuer die Consent-Seite (Frontend). Query = die vom Plugin angehaengte signierte Query, unveraendert.
export default defineEventHandler(async (event): Promise<ConsentInfo> => {
  await requireUser(event)
  noStore(event)
  const cfg = getConfig()
  const raw = getRequestURL(event).search.slice(1)
  if (!raw || !(await verifyOAuthQueryParams(raw, cfg.betterAuthSecret).catch(() => false))) {
    throw apiError(400, 'invalid_consent_query', 'the consent query is invalid or expired')
  }
  const q = new URLSearchParams(raw)
  const clientId = q.get('client_id') ?? ''
  const db = await getDb()
  const [client] = await db.select().from(oauthClient).where(eq(oauthClient.clientId, clientId))
  if (!client || client.disabled) throw apiError(404, 'client_not_found', 'client not found')
  const [meta] = await db.select().from(oauthClientMeta).where(eq(oauthClientMeta.clientId, clientId))
  return buildConsentInfo({
    client: {
      id: client.clientId,
      name: client.name,
      redirectUris: client.redirectUris,
      registeredAt: meta?.createdAt ?? client.createdAt ?? new Date(0),
      viaDcr: (meta?.registeredVia ?? 'admin') === 'dcr',
    },
    requestedScopes: parseScopeString(q.get('scope')),
    allowlist: await listAllowlist(db),
    baseUrl: cfg.baseUrl,
  }) satisfies ConsentInfo
})
