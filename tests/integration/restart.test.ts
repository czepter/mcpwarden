import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { ADMIN, api, countMigrations, createInstance, signUpFirstAdmin, startServer, type TestInstance } from './harness'

// Expected number = entries in the Drizzle journal; a repeated start must not increase it.
const JOURNAL_ENTRIES: number = JSON.parse(readFileSync('server/db/migrations/meta/_journal.json', 'utf8')).entries.length

let inst: TestInstance
beforeAll(async () => { inst = await createInstance() })
afterAll(async () => { await inst?.cleanup() })

it('Restart (SIGTERM) keeps users; migrations idempotent (A2, A4)', async () => {
  const s1 = await startServer(inst)
  await signUpFirstAdmin(s1)
  expect(await s1.stop()).toBe(0)
  expect(s1.logs()).toContain('shutdown: db closed')
  expect(await countMigrations(inst)).toBe(JOURNAL_ENTRIES)

  const s2 = await startServer(inst)
  const c = api(s2.url)
  const r = await c.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
  expect(r.status).toBe(200)
  expect((await c.request('/api/auth/get-session')).json.user.role).toBe('admin')
  // Registration stays closed after the restart.
  expect((await api(s2.url).request('/api/auth/sign-up/email', { body: { name: 'Z', email: 'z@example.com', password: 'z-password-1234' } })).status).toBe(403)
  expect(await s2.stop()).toBe(0)
  expect(await countMigrations(inst)).toBe(JOURNAL_ENTRIES)
})
