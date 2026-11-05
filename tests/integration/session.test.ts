// requireUser/requireAdmin gegen echte Auth-Instanz (in-process, kein Testcode im Produktbundle).
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { createInstance, type TestInstance } from './harness'

let inst: TestInstance
let session: typeof import('../../server/utils/session')
let auth: Awaited<ReturnType<typeof import('../../server/auth').getAuth>>
let dbMod: typeof import('../../server/db')

const ev = (cookie?: string) => ({ headers: new Headers(cookie ? { cookie } : {}) }) as unknown as H3Event
async function login(email: string, password: string) {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true })
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

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
  session = await import('../../server/utils/session')
  auth = await (await import('../../server/auth')).getAuth()
})
afterAll(async () => {
  await dbMod?.closeDb()
  await inst?.cleanup()
})

it('requireUser/requireAdmin: 401 ohne Session, 403 fuer user, ok fuer admin', async () => {
  await expect(session.requireUser(ev())).rejects.toMatchObject({ statusCode: 401 })
  await auth.api.signUpEmail({ body: { name: 'A', email: 'a@example.com', password: 'passwort-12345' } })
  const adminCookie = await login('a@example.com', 'passwort-12345')
  const admin = await session.requireAdmin(ev(adminCookie))
  expect(admin.user.role).toBe('admin')

  const created = await auth.api.createUser({
    body: { name: 'B', email: 'b@example.com', password: 'passwort-12345', role: 'user' },
    headers: new Headers({ cookie: adminCookie }),
  })
  const userCookie = await login('b@example.com', 'passwort-12345')
  expect((await session.requireUser(ev(userCookie))).user.id).toBe(created.user.id)
  await expect(session.requireAdmin(ev(userCookie))).rejects.toMatchObject({ statusCode: 403 })
})
