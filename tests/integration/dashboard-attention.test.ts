// Spec P0-16: die Aufmerksamkeitsliste enthaelt degraded, open, auth_expired, awaiting_auth und awaiting_approval, jeweils mit
// setup und statusReason; gesunde, bereite Upstreams nicht. Gegen die echte Datenbank (PGlite/Postgres).
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

it('attention covers all five states and nothing else', async () => {
  const db = await dbMod.getDb()
  const { user, upstream } = await import('../../server/db/schema')
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  const { dashboard } = await import('../../server/gateway/service')
  await db.insert(user).values({ id: 'u1', name: 'U', email: 'u@example.com' })
  const mk = (slug: string, status: string, setup: string) => ({ userId: 'u1', slug, name: slug, type: 'http', url: 'https://x.example/mcp', status, setup, statusReason: ['healthy', 'unknown'].includes(status) ? null : `Grund ${slug}` })
  await db.insert(upstream).values([
    mk('ok', 'healthy', 'ready'), mk('fresh', 'unknown', 'ready'), mk('degr', 'degraded', 'ready'), mk('open', 'open', 'ready'),
    mk('expired', 'auth_expired', 'ready'), mk('needauth', 'unknown', 'awaiting_auth'), mk('needok', 'unknown', 'awaiting_approval'),
  ])
  const repo = new GatewayRepo(db)
  expect((await repo.attention('u1')).map(r => r.slug).sort()).toEqual(['degr', 'expired', 'needauth', 'needok', 'open'])

  // Dienst: setup im Eintrag, Wartegrund als statusReason (Health-Zustand ohne eigenen Grund)
  const rt = { repo, gw: { healthFor: () => ({ breaker: { nextRetryAt: null } }), limiter: { hitsLast5m: () => 0 } } } as never
  const d = await dashboard(rt, { id: 'u1', role: 'user' }, { connections: [] })
  const by = Object.fromEntries(d.attention.map(a => [a.slug, a]))
  expect(d.attentionCount).toBe(5)
  expect(by.needauth).toMatchObject({ setup: 'awaiting_auth', status: 'unknown', statusReason: expect.stringContaining('Zugangsdaten') })
  expect(by.needok).toMatchObject({ setup: 'awaiting_approval', statusReason: expect.stringContaining('Freigabe') })
  expect(by.open).toMatchObject({ setup: 'ready', statusReason: 'Grund open' })
  for (const a of d.attention) expect(a.statusReason).toBeTruthy()
})
