import { describe, expect, it, vi } from 'vitest'
import { createAccessGuard, type AccessStore, type OAuthAccessRow, type PatAccessRow, type VerifiedAccessToken } from '../../server/auth/access-guard'
import { generatePat } from '../../server/auth/pat'

const RESOURCE = 'http://localhost:3000/mcp'
const PRM = 'http://localhost:3000/.well-known/oauth-protected-resource/mcp'
const NOW = new Date('2026-06-01T12:00:00Z')
const user = { id: 'u1', role: 'user' as const, banned: false, banExpires: null }

const claims = (over: Partial<VerifiedAccessToken> = {}): VerifiedAccessToken => ({
  userId: 'u1', clientId: 'c1', scopes: ['openid', 'offline_access', 'mcp:tools'], audience: [RESOURCE], expiresAt: 1_800_000_000, jti: 'jti-1', ...over,
})
const goodRow = (over: Partial<OAuthAccessRow> = {}): OAuthAccessRow => ({
  user, client: { id: 'c1', name: 'Claude Code', disabled: false }, hasConsent: true, hasLiveRefreshToken: true, ...over,
})

function setup(opts: { claims?: VerifiedAccessToken | null, row?: OAuthAccessRow, pat?: PatAccessRow | null } = {}) {
  const store: AccessStore = {
    loadOAuthAccess: vi.fn(async () => opts.row ?? goodRow()),
    loadPatAccess: vi.fn(async () => opts.pat ?? null),
    touchConnection: vi.fn(async () => {}),
    touchPat: vi.fn(async () => {}),
  }
  const verifyAccessToken = vi.fn(async () => (opts.claims === undefined ? claims() : opts.claims))
  const guard = createAccessGuard({ resource: RESOURCE, resourceMetadataUrl: PRM, verifyAccessToken, store, now: () => NOW })
  const call = (auth?: string) => guard(new Request(RESOURCE, { method: 'POST', headers: auth ? { authorization: auth } : {} }))
  return { store, verifyAccessToken, call }
}

async function expect401(res: unknown, desc?: string) {
  expect(res).toBeInstanceOf(Response)
  const r = res as Response
  expect(r.status).toBe(401)
  expect(r.headers.get('www-authenticate')).toContain(`resource_metadata="${PRM}"`)
  if (desc) expect(r.headers.get('www-authenticate')).toContain(desc)
}

describe('authenticateMcpRequest: oauth', () => {
  it('returns the same AuthContext shape for a valid token', async () => {
    const { call, store } = setup()
    const res = await call('Bearer abc.def.ghi')
    expect(res).not.toBeInstanceOf(Response)
    expect((res as { ctx: unknown }).ctx).toEqual({
      userId: 'u1', role: 'user', tokenType: 'oauth', tokenId: 'jti-1', clientId: 'c1', clientName: 'Claude Code',
      scopes: ['openid', 'offline_access', 'mcp:tools'], expiresAt: 1_800_000_000, resource: RESOURCE,
    })
    expect(store.touchConnection).toHaveBeenCalledWith('u1', 'c1', NOW)
  })
  it('missing / malformed header -> 401 without error code, no DB access', async () => {
    const { call, store } = setup()
    for (const h of [undefined, 'Basic abc', 'Bearer', 'Bearer a b']) {
      const res = await call(h) as Response
      await expect401(res)
      expect(res.headers.get('www-authenticate')).not.toContain('error=')
    }
    expect(store.loadOAuthAccess).not.toHaveBeenCalled()
  })
  it('invalid/expired token (verifier null) -> 401 invalid_token', async () => {
    await expect401(await setup({ claims: null }).call('Bearer x.y.z'), 'error="invalid_token"')
  })
  it('wrong audience -> 401, before any DB access', async () => {
    const s = setup({ claims: claims({ audience: ['http://other/mcp'] }) })
    await expect401(await s.call('Bearer x.y.z'), 'audience')
    expect(s.store.loadOAuthAccess).not.toHaveBeenCalled()
    await expect401(await setup({ claims: claims({ audience: [] }) }).call('Bearer x.y.z'))
  })
  it.each([
    ['user missing', goodRow({ user: null })],
    ['user banned', goodRow({ user: { ...user, banned: true } })],
    ['ban without expiry', goodRow({ user: { ...user, banned: true, banExpires: null } })],
    ['ban expires in future', goodRow({ user: { ...user, banned: true, banExpires: new Date(NOW.getTime() + 1000) } })],
    ['client missing', goodRow({ client: null })],
    ['client disabled', goodRow({ client: { id: 'c1', name: 'x', disabled: true } })],
    ['consent revoked', goodRow({ hasConsent: false })],
    ['only refresh token revoked (consent stays)', goodRow({ hasLiveRefreshToken: false })],
  ])('instant revocation: %s -> 401 while JWT is still valid', async (_n, row) => {
    const s = setup({ row })
    await expect401(await s.call('Bearer x.y.z'))
    expect(s.store.touchConnection).not.toHaveBeenCalled()
  })
  it('expired ban no longer blocks', async () => {
    const row = goodRow({ user: { ...user, banned: true, banExpires: new Date(NOW.getTime() - 1000) } })
    expect((await setup({ row }).call('Bearer x.y.z') as Response).status).toBeUndefined()
  })
  it('R15: token whose client never had a refresh token -> 401, regardless of scope claim', async () => {
    for (const scopes of [['mcp:tools'], ['openid', 'offline_access', 'mcp:tools']]) {
      await expect401(await setup({ claims: claims({ scopes }), row: goodRow({ hasLiveRefreshToken: false }) }).call('Bearer x.y.z'))
    }
  })
  it('missing mcp:tools -> 403 insufficient_scope', async () => {
    const res = await setup({ claims: claims({ scopes: ['openid'] }) }).call('Bearer x.y.z') as Response
    expect(res.status).toBe(403)
    expect(res.headers.get('www-authenticate')).toContain('insufficient_scope')
  })
  it('revoked state wins over scope (no scope info leak): revoked + no scope -> 401', async () => {
    await expect401(await setup({ claims: claims({ scopes: ['openid'] }), row: goodRow({ hasConsent: false }) }).call('Bearer x.y.z'))
  })
  it('throttles last_used writes to once per minute', async () => {
    const s = setup()
    await s.call('Bearer x.y.z')
    await s.call('Bearer x.y.z')
    expect(s.store.touchConnection).toHaveBeenCalledTimes(1)
  })
  it('store failure -> 500 without details', async () => {
    const s = setup()
    s.store.loadOAuthAccess = vi.fn(async () => { throw new Error('db down: secret-detail') })
    const res = await s.call('Bearer x.y.z') as Response
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('secret-detail')
  })
})

describe('authenticateMcpRequest: pat', () => {
  const pat = generatePat()
  const row = (over: Partial<PatAccessRow['pat']> = {}, u = user): PatAccessRow => ({ pat: { id: 'p1', tokenHash: pat.hash, revokedAt: null, ...over }, user: u })

  it('valid PAT -> context with null client, touches last_used', async () => {
    const s = setup({ pat: row() })
    const res = await s.call(`Bearer ${pat.token}`)
    expect((res as { ctx: unknown }).ctx).toEqual({
      userId: 'u1', role: 'user', tokenType: 'pat', tokenId: 'p1', clientId: null, clientName: null,
      scopes: ['mcp:tools'], expiresAt: null, resource: RESOURCE,
    })
    expect(s.store.loadPatAccess).toHaveBeenCalledWith(pat.hash)
    expect(s.verifyAccessToken).not.toHaveBeenCalled()
    expect(s.store.touchPat).toHaveBeenCalledWith('p1', NOW)
  })
  it('unknown, revoked, banned-owner PAT -> 401', async () => {
    await expect401(await setup({ pat: null }).call(`Bearer ${pat.token}`))
    await expect401(await setup({ pat: row({ revokedAt: NOW }) }).call(`Bearer ${pat.token}`))
    await expect401(await setup({ pat: row({}, { ...user, banned: true }) }).call(`Bearer ${pat.token}`))
  })
  it('hash mismatch from the store is rejected', async () => {
    await expect401(await setup({ pat: row({ tokenHash: 'f'.repeat(64) }) }).call(`Bearer ${pat.token}`))
  })
})
