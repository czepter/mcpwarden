// Device labels: PAT create/list/rename, OAuth connection label and rename with ownership checks, cleanup on revoke.
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createInstance, type TestInstance } from './harness'

let inst: TestInstance
let dbMod: typeof import('../../server/db')

beforeAll(async () => {
  inst = await createInstance()
  Object.assign(process.env, {
    BASE_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    MASTER_KEY: 'ab'.repeat(32),
    DATA_DIR: inst.dataDir,
    RATE_LIMIT: 'off',
  })
  if (inst.databaseUrl) process.env.DATABASE_URL = inst.databaseUrl
  else delete process.env.DATABASE_URL
  dbMod = await import('../../server/db')
})
afterAll(async () => {
  await dbMod?.closeDb()
  await inst?.cleanup()
})

it('PAT device name is stored, listed and renamed only by its owner', async () => {
  const db = await dbMod.getDb()
  const { user } = await import('../../server/db/schema')
  const { createPat, listPats } = await import('../../server/auth/pat-store')
  const { renamePat } = await import('../../server/auth/device-name')
  await db.insert(user).values([{ id: 'p1', name: 'A', email: 'pa@example.com' }, { id: 'p2', name: 'B', email: 'pb@example.com' }])
  const made = await createPat(db, 'p1', 'nas-cron', { deviceName: 'NAS' })
  expect(made?.deviceName).toBe('NAS')
  const plain = await createPat(db, 'p1', 'no-device')
  expect(plain?.deviceName).toBeNull()
  expect((await listPats(db, 'p1')).items.map(i => i.deviceName)).toEqual(['NAS', null])
  expect(await renamePat(db, 'p2', made!.id, 'hijack')).toBe(false)
  expect(await renamePat(db, 'p1', made!.id, 'Mac mini')).toBe(true)
  expect((await listPats(db, 'p1')).items[0]!.deviceName).toBe('Mac mini')
  expect(await renamePat(db, 'p1', made!.id, null)).toBe(true)
  expect((await listPats(db, 'p1')).items[0]!.deviceName).toBeNull()
  expect(await renamePat(db, 'p1', 'not-a-uuid', 'x')).toBe(false)
})

it('connection device name: only with an own consent, per user, removed on revoke', async () => {
  const db = await dbMod.getDb()
  const { user } = await import('../../server/db/schema')
  const { oauthClient, oauthConsent } = await import('../../server/db/schema/auth')
  const { listConnections, revokeConnection } = await import('../../server/auth/pat-store')
  const { renameConnection, setConnectionDevice } = await import('../../server/auth/device-name')
  const now = new Date()
  await db.insert(user).values([{ id: 'c1', name: 'A', email: 'ca@example.com' }, { id: 'c2', name: 'B', email: 'cb@example.com' }])
  await db.insert(oauthClient).values({ id: 'oc1', clientId: 'client-1', name: 'Claude Code', redirectUris: ['http://localhost:33418/callback'], createdAt: now, updatedAt: now } as never)
  await db.insert(oauthConsent).values({ id: 'k1', clientId: 'client-1', userId: 'c1', scopes: ['mcp:tools'], createdAt: now, updatedAt: now })
  // no consent yet for c2: rename is refused
  expect(await renameConnection(db, 'c2', 'client-1', 'Laptop')).toBe(false)
  // consent page stores the label before the grant (upsert)
  await setConnectionDevice(db, 'c1', 'client-1', 'Mac · Safari')
  expect((await listConnections(db, 'c1', now))[0]!.deviceName).toBe('Mac · Safari')
  expect(await renameConnection(db, 'c1', 'client-1', 'MacBook Pro')).toBe(true)
  expect((await listConnections(db, 'c1', now))[0]!.deviceName).toBe('MacBook Pro')
  expect(await listConnections(db, 'c2', now)).toEqual([])
  expect(await renameConnection(db, 'c1', 'client-1', null)).toBe(true)
  expect((await listConnections(db, 'c1', now))[0]!.deviceName).toBeNull()
  await setConnectionDevice(db, 'c1', 'client-1', 'again')
  expect(await revokeConnection(db, 'c1', 'client-1')).toBe(true)
  const { oauthConnectionDevice } = await import('../../server/db/schema/mcp')
  expect(await db.select().from(oauthConnectionDevice)).toEqual([])
})
