// Review H-A (Sicherheitsnetz): Sperren/Loeschen ueber einen Better-Auth-Pfad (hier: serverseitige Direktaufrufe ohne die
// mcpwarden-Admin-Routen) stoesst dieselbe Aufraeumkette an (user.update.after / user.delete.before).
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createInstance, type TestInstance } from './harness'

let inst: TestInstance
let auth: Awaited<ReturnType<typeof import('../../server/auth').getAuth>>
let dbMod: typeof import('../../server/db')
let lifecycle: typeof import('../../server/utils/user-lifecycle')

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
  lifecycle = await import('../../server/utils/user-lifecycle')
  auth = await (await import('../../server/auth')).getAuth()
})
afterAll(async () => {
  lifecycle?.resetLifecycleHandlers()
  await dbMod?.closeDb()
  await inst?.cleanup()
})

it('banning or deleting through Better Auth runs the user-disabled cleanup chain', async () => {
  await auth.api.signUpEmail({ body: { name: 'A', email: 'a@example.com', password: 'passwort-12345' } })
  const res = await auth.api.signInEmail({ body: { email: 'a@example.com', password: 'passwort-12345' }, asResponse: true })
  const headers = new Headers({ cookie: res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') })
  const b = await auth.api.createUser({ headers, body: { name: 'B', email: 'b@example.com', password: 'passwort-12345', role: 'user' } })
  const c = await auth.api.createUser({ headers, body: { name: 'C', email: 'c@example.com', password: 'passwort-12345', role: 'user' } })

  const seen: string[] = []
  lifecycle.registerLifecycleHandler({ name: 'probe', onUserDisabled: (id) => { seen.push(id) } })

  await auth.api.banUser({ headers, body: { userId: b.user.id } })
  expect(seen).toEqual([b.user.id])

  await auth.api.unbanUser({ headers, body: { userId: b.user.id } })
  expect(seen).toEqual([b.user.id]) // Entsperren raeumt nichts auf

  await auth.api.removeUser({ headers, body: { userId: c.user.id } })
  expect(seen).toEqual([b.user.id, c.user.id])
})
