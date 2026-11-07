/**
 * OAuth against an upstream MCP server (authorization code + PKCE, dynamic client registration, refresh).
 *
 * One encrypted JSON document per upstream holds the client registration, tokens, discovery state and the PKCE verifier; the
 * hash of the pending `state` is stored next to it so that the callback can find the row. The SDK drives the protocol
 * (`auth()` / transport `authProvider`); this file only supplies storage. Two modes:
 *  - interactive (start/callback of the connect flow): `redirectToAuthorization` captures the authorization URL,
 *  - runtime (pool connections): a needed redirect means the user has to reconnect, never a silent flow.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { OAuthClientInformationContext, OAuthClientMetadata, OAuthClientProvider, OAuthDiscoveryState, StoredOAuthClientInformation, StoredOAuthTokens } from '@modelcontextprotocol/client'
import { decryptSecret, encryptSecret } from '../crypto/secrets'
import { OAuthReauthError } from './errors'

export type OAuthData = {
  clientInfo?: StoredOAuthClientInformation
  tokens?: StoredOAuthTokens
  discovery?: OAuthDiscoveryState
  verifier?: string
}

export const OAUTH_STATE_TTL_MS = 10 * 60_000
const KIND = 'oauth'
export const hashState = (state: string) => createHash('sha256').update(state).digest('hex')

/** Row access (implemented by `GatewayRepo`); ciphertext only. */
export interface OAuthRows {
  getOAuth(userId: string, upstreamId: string): Promise<{ data: string | null } | null>
  saveOAuth(userId: string, upstreamId: string, p: { data: string | null, pending?: { stateHash: string, expiresAt: Date } | null, connected: boolean }): Promise<void>
  deleteOAuth(userId: string, upstreamId: string): Promise<void>
}

export class OAuthVault {
  constructor(private rows: OAuthRows, private masterKey: Buffer) {}
  private ctx = (upstreamId: string) => ({ upstreamId, kind: KIND, name: '' })
  async load(userId: string, upstreamId: string): Promise<OAuthData> {
    const r = await this.rows.getOAuth(userId, upstreamId)
    if (!r?.data) return {}
    return JSON.parse(decryptSecret(this.masterKey, userId, this.ctx(upstreamId), r.data)) as OAuthData
  }
  async save(userId: string, upstreamId: string, data: OAuthData, pending?: { stateHash: string, expiresAt: Date } | null) {
    const ciphertext = encryptSecret(this.masterKey, userId, this.ctx(upstreamId), JSON.stringify(data))
    await this.rows.saveOAuth(userId, upstreamId, { data: ciphertext, pending, connected: !!data.tokens })
  }
  async remove(userId: string, upstreamId: string) { await this.rows.deleteOAuth(userId, upstreamId) }
}

export type ProviderOptions = {
  vault: OAuthVault
  userId: string
  upstreamId: string
  redirectUrl: string
  /** true: the connect flow (captures the authorization URL); false: runtime, a redirect means "reconnect". */
  interactive: boolean
}

export class UpstreamOAuthProvider implements OAuthClientProvider {
  /** Set by `redirectToAuthorization` in interactive mode. */
  authorizationUrl: URL | null = null
  private data: OAuthData | null = null
  constructor(private o: ProviderOptions) {}

  private async d(): Promise<OAuthData> { return (this.data ??= await this.o.vault.load(this.o.userId, this.o.upstreamId)) }
  private async persist(pending?: { stateHash: string, expiresAt: Date } | null) { await this.o.vault.save(this.o.userId, this.o.upstreamId, await this.d(), pending) }

  get redirectUrl() { return this.o.redirectUrl }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'mcpwarden', redirect_uris: [this.o.redirectUrl], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none',
    }
  }

  async state() {
    const s = randomBytes(32).toString('base64url')
    await this.persist({ stateHash: hashState(s), expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS) })
    return s
  }
  async clientInformation(_ctx?: OAuthClientInformationContext) { return (await this.d()).clientInfo }
  async saveClientInformation(info: StoredOAuthClientInformation) { (await this.d()).clientInfo = info; await this.persist() }
  async tokens(_ctx?: OAuthClientInformationContext) { return (await this.d()).tokens }
  async saveTokens(tokens: StoredOAuthTokens) {
    const d = await this.d()
    d.tokens = tokens
    delete d.verifier // single use
    await this.persist()
  }
  async saveCodeVerifier(v: string) { (await this.d()).verifier = v; await this.persist() }
  async codeVerifier() {
    const v = (await this.d()).verifier
    if (!v) throw new Error('no PKCE verifier stored')
    return v
  }
  async saveDiscoveryState(s: OAuthDiscoveryState) { (await this.d()).discovery = s; await this.persist() }
  async discoveryState() { return (await this.d()).discovery }
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    const d = await this.d()
    if (scope === 'all' || scope === 'client') delete d.clientInfo
    if (scope === 'all' || scope === 'tokens') delete d.tokens
    if (scope === 'all' || scope === 'verifier') delete d.verifier
    if (scope === 'all' || scope === 'discovery') delete d.discovery
    await this.persist()
  }
  redirectToAuthorization(url: URL) {
    if (!this.o.interactive) throw new OAuthReauthError()
    this.authorizationUrl = url
  }
}
