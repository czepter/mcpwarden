// DB-nahe Logik gegen In-Memory-PGlite mit den echten Migrationen.
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db'
import { runMigrations } from '../../server/db/migrate'
import * as schema from '../../server/db/schema'
import {
  addAllowlistEntry, deleteClient, deleteExpiredClients, getDcrMode, listAdminClients, listAllowlist, recordClientMeta, removeAllowlistEntry,
  resetBuiltins, seedAllowlist, setClientDisabled, setDcrMode, validateAllowlistInput,
} from '../../server/auth/dcr-store'
import { BUILTIN_ALLOWLIST } from '../../server/auth/dcr-policy'

let client: PGlite
let db: Db
const DAY = 24 * 3600_000

beforeAll(async () => {
  client = await PGlite.create()
  db = drizzle({ client, schema }) as unknown as Db
  await runMigrations(db, 'pglite')
  await db.insert(schema.user).values({ id: 'u1', name: 'U', email: 'u@example.com', emailVerified: true, createdAt: new Date(), updatedAt: new Date() })
})
afterAll(() => client.close())

async function addClient(clientId: string, over: Partial<typeof schema.oauthClient.$inferInsert> = {}) {
  await db.insert(schema.oauthClient).values({ id: `id-${clientId}`, clientId, name: 'Claude Code', redirectUris: ['http://127.0.0.1:1/cb'], createdAt: new Date(), ...over })
}

describe('dcr mode', () => {
  it('defaults to open and persists changes', async () => {
    expect(await getDcrMode(db)).toBe('open')
    await setDcrMode(db, 'allowlist')
    expect(await getDcrMode(db)).toBe('allowlist')
    await setDcrMode(db, 'off')
    expect(await getDcrMode(db)).toBe('off')
    await setDcrMode(db, 'open')
  })
})

describe('allowlist', () => {
  it('seeds the builtins exactly once and idempotently', async () => {
    await seedAllowlist(db)
    await seedAllowlist(db)
    const list = await listAllowlist(db)
    expect(list).toHaveLength(BUILTIN_ALLOWLIST.length)
    expect(list.every(e => e.builtin)).toBe(true)
  })
  it('does not resurrect deleted builtins on re-seed, reset-builtins does', async () => {
    const first = (await listAllowlist(db))[0]!
    expect(await removeAllowlistEntry(db, first.id)).toBe(true)
    await seedAllowlist(db)
    expect(await listAllowlist(db)).toHaveLength(BUILTIN_ALLOWLIST.length - 1)
    await resetBuiltins(db)
    await resetBuiltins(db)
    expect(await listAllowlist(db)).toHaveLength(BUILTIN_ALLOWLIST.length)
  })
  it('adds custom entries and rejects unknown ids', async () => {
    const e = await addAllowlistEntry(db, { label: 'Mine', namePattern: 'Mine*', redirectPatterns: ['mine://'] })
    expect(e.builtin).toBe(false)
    expect(await removeAllowlistEntry(db, e.id)).toBe(true)
    expect(await removeAllowlistEntry(db, e.id)).toBe(false)
    expect(await removeAllowlistEntry(db, 'not-a-uuid')).toBe(false)
  })
  it('validates input', () => {
    const ok = { label: 'A', namePattern: 'A*', redirectPatterns: ['http://localhost:*', 'cursor://', 'https://a.example/cb'] }
    expect(validateAllowlistInput(ok)).toEqual({ ok: true, value: ok })
    for (const [patch, field] of [
      [{ label: '' }, 'label'], [{ label: 'x'.repeat(65) }, 'label'], [{ namePattern: '' }, 'namePattern'], [{ redirectPatterns: [] }, 'redirectPatterns'],
      [{ redirectPatterns: ['javascript://x'] }, 'redirectPatterns'], [{ redirectPatterns: ['http://evil.example/cb'] }, 'redirectPatterns'],
      [{ redirectPatterns: ['nonsense'] }, 'redirectPatterns'], [{ redirectPatterns: [1] }, 'redirectPatterns'],
    ] as const) {
      expect(validateAllowlistInput({ ...ok, ...patch })).toEqual({ ok: false, field })
    }
    expect(validateAllowlistInput(null)).toMatchObject({ ok: false })
  })
})

describe('clients', () => {
  it('lists with live allowlisted, userCount, lastUsedAt and the expiresAt rule', async () => {
    await addClient('c-list')
    await recordClientMeta(db, 'c-list', false)
    let [c] = (await listAdminClients(db)).filter(x => x.id === 'c-list')
    expect(c).toMatchObject({ id: 'c-list', registeredVia: 'dcr', disabled: false, userCount: 0, lastUsedAt: null, allowlisted: true })
    expect(Date.parse(c!.expiresAt!) - Date.parse(c!.createdAt)).toBe(30 * DAY)
    const used = new Date('2026-01-01T00:00:00Z')
    await db.insert(schema.oauthConnectionUse).values({ userId: 'u1', clientId: 'c-list', lastUsedAt: used })
    await db.insert(schema.oauthConsent).values({ id: 'cons1', clientId: 'c-list', userId: 'u1', scopes: ['mcp:tools'], createdAt: new Date(), updatedAt: new Date() })
    ;[c] = (await listAdminClients(db)).filter(x => x.id === 'c-list')
    expect(c).toMatchObject({ userCount: 1, lastUsedAt: used.toISOString(), expiresAt: null })
  })
  it('disables and deletes with cascade to consents, usage and meta', async () => {
    expect(await setClientDisabled(db, 'c-list', true)).toBe(true)
    expect((await listAdminClients(db)).find(x => x.id === 'c-list')!.disabled).toBe(true)
    expect(await setClientDisabled(db, 'nope', true)).toBe(false)
    expect(await deleteClient(db, 'c-list')).toBe(true)
    expect(await db.select().from(schema.oauthConsent).where(eq(schema.oauthConsent.clientId, 'c-list'))).toHaveLength(0)
    expect(await db.select().from(schema.oauthClientMeta).where(eq(schema.oauthClientMeta.clientId, 'c-list'))).toHaveLength(0)
    expect(await deleteClient(db, 'c-list')).toBe(false)
  })
  it('expiry deletes only unused dcr clients older than 30 days', async () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const old = new Date(now.getTime() - 31 * DAY)
    const fresh = new Date(now.getTime() - 29 * DAY)
    for (const id of ['x-old-unused', 'x-old-used', 'x-fresh', 'x-old-admin']) await addClient(id)
    await db.insert(schema.oauthClientMeta).values([
      { clientId: 'x-old-unused', allowlisted: false, registeredVia: 'dcr', createdAt: old },
      { clientId: 'x-old-used', allowlisted: false, registeredVia: 'dcr', createdAt: old },
      { clientId: 'x-fresh', allowlisted: false, registeredVia: 'dcr', createdAt: fresh },
      { clientId: 'x-old-admin', allowlisted: false, registeredVia: 'admin', createdAt: old },
    ])
    await db.insert(schema.oauthConnectionUse).values({ userId: 'u1', clientId: 'x-old-used', lastUsedAt: now })
    expect(await deleteExpiredClients(db, now)).toBe(1)
    const ids = (await listAdminClients(db)).map(c => c.id)
    expect(ids).not.toContain('x-old-unused')
    expect(ids).toEqual(expect.arrayContaining(['x-old-used', 'x-fresh', 'x-old-admin']))
    expect(await deleteExpiredClients(db, now)).toBe(0)
  })
})
