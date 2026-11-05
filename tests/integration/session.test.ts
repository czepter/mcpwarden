// requireUser/requireAdmin against a real auth instance (in-process, no test code in the product bundle).
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { user } from '../../server/db/schema'
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

it('requireUser/requireAdmin: 401 without session, 403 for user, ok for admin', async () => {
  await expect(session.requireUser(ev())).rejects.toMatchObject({ statusCode: 401 })
  await auth.api.signUpEmail({ body: { name: 'A', email: 'a@example.com', password: 'password-12345' } })
  const adminCookie = await login('a@example.com', 'password-12345')
  const admin = await session.requireAdmin(ev(adminCookie))
  expect(admin.user.role).toBe('admin')

  const created = await auth.api.createUser({
    body: { name: 'B', email: 'b@example.com', password: 'password-12345', role: 'user' },
    headers: new Headers({ cookie: adminCookie }),
  })
  const userCookie = await login('b@example.com', 'password-12345')
  expect((await session.requireUser(ev(userCookie))).user.id).toBe(created.user.id)
  await expect(session.requireAdmin(ev(userCookie))).rejects.toMatchObject({ statusCode: 403 })
})

it('requireUser honours banExpires: an active ban refuses, an expired one does not (review L-g)', async () => {
  const cookie = await login('b@example.com', 'password-12345')
  const id = (await session.requireUser(ev(cookie))).user.id
  const db = await dbMod.getDb()
  await db.update(user).set({ banned: true, banExpires: new Date(Date.now() + 3_600_000) }).where(eq(user.id, id))
  await expect(session.requireUser(ev(cookie))).rejects.toMatchObject({ statusCode: 403 })
  await db.update(user).set({ banned: true, banExpires: new Date(Date.now() - 1000) }).where(eq(user.id, id))
  expect((await session.requireUser(ev(cookie))).user.id).toBe(id)
  await db.update(user).set({ banned: true, banExpires: null }).where(eq(user.id, id))
  await expect(session.requireUser(ev(cookie))).rejects.toMatchObject({ statusCode: 403 })
})
