// Review L-i: Scheitert das Anlegen des Nutzers, nachdem die Einladung beansprucht wurde, wird sie wieder freigegeben.
// Der Fehler kommt aus der Datenbank (Trigger), also genau nach dem Beanspruchen im Before-Hook.
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createInstance, type TestInstance } from './harness'

let inst: TestInstance
let auth: Awaited<ReturnType<typeof import('../../server/auth').getAuth>>
let dbMod: typeof import('../../server/db')
let repo: import('../../server/gateway/upstream/repo').GatewayRepo

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
  const { GatewayRepo } = await import('../../server/gateway/upstream/repo')
  auth = await (await import('../../server/auth')).getAuth()
  repo = new GatewayRepo(await dbMod.getDb())
})
afterAll(async () => {
  await dbMod?.closeDb()
  await inst?.cleanup()
})

it('an invite is released when creating the user fails after it was claimed', async () => {
  const admin = await auth.api.signUpEmail({ body: { name: 'A', email: 'a@example.com', password: 'passwort-12345' } })
  const db = await dbMod.getDb()
  await db.execute(sql`
    create function mcpw_test_fail_user() returns trigger as $$
    begin
      if new.email = 'boom@example.com' then raise exception 'simulated insert failure'; end if;
      return new;
    end $$ language plpgsql`)
  await db.execute(sql`create trigger mcpw_test_fail_user before insert on "user" for each row execute function mcpw_test_fail_user()`)

  const { token, row } = await repo.createInvite(admin.user.id, null)
  const signUp = (email: string) => auth.api.signUpEmail({ body: { name: 'N', email, password: 'passwort-12345' }, headers: new Headers({ 'x-invite-token': token }) })

  await expect(signUp('boom@example.com')).rejects.toBeDefined()
  const after = await repo.inviteByToken(token)
  expect(after && repo.inviteStatus(after)).toBe('open')
  expect(after?.usedAt).toBeNull()

  // dieselbe Einladung ist weiter verwendbar und wird dann ganz normal verbraucht
  const ok = await signUp('ok@example.com')
  const used = await repo.inviteByToken(token)
  expect(used && repo.inviteStatus(used)).toBe('used')
  expect(used?.usedBy).toBe(ok.user.id)
  expect(row.id).toBe(used?.id)
  await expect(signUp('second@example.com')).rejects.toBeDefined() // einmalig
})
