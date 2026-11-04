import { afterAll, beforeAll, expect, it } from 'vitest'
import { ADMIN, api, countMigrations, createInstance, signUpFirstAdmin, startServer, type TestInstance } from './harness'

let inst: TestInstance
beforeAll(async () => { inst = await createInstance() })
afterAll(async () => { await inst?.cleanup() })

it('Neustart (SIGTERM) behaelt Nutzer; Migrationen idempotent (A2, A4)', async () => {
  const s1 = await startServer(inst)
  await signUpFirstAdmin(s1)
  expect(await s1.stop()).toBe(0)
  expect(s1.logs()).toContain('shutdown: db closed')
  expect(await countMigrations(inst)).toBe(1)

  const s2 = await startServer(inst)
  const c = api(s2.url)
  const r = await c.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })
  expect(r.status).toBe(200)
  expect((await c.request('/api/auth/get-session')).json.user.role).toBe('admin')
  // Registrierung bleibt nach dem Neustart gesperrt.
  expect((await api(s2.url).request('/api/auth/sign-up/email', { body: { name: 'Z', email: 'z@example.com', password: 'z-passwort-1234' } })).status).toBe(403)
  expect(await s2.stop()).toBe(0)
  expect(await countMigrations(inst)).toBe(1)
})
