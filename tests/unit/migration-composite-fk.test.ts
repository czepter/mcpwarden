// Review M-E: upstream_secret und upstream_tool koennen nicht mehr zu einem Upstream eines anderen Nutzers gehoeren
// (UNIQUE(user_id, id) auf upstream, zusammengesetzte Fremdschluessel). Die Migration erhaelt vorhandene Daten.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const FULL = resolve('server/db/migrations')
let client: PGlite
const count = async (sql: string) => ((await client.query<{ n: number }>(sql)).rows[0]!).n

/** Ordner mit dem Stand vor der Migration (nur die Eintraege bis `0004_user_preference`). */
function olderMigrations(lastTag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcpw-mig-old-'))
  mkdirSync(join(dir, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(FULL, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }
  const upto = journal.entries.findIndex(e => e.tag === lastTag)
  expect(upto).toBeGreaterThan(0)
  const entries = journal.entries.slice(0, upto + 1)
  for (const e of entries) cpSync(join(FULL, `${e.tag}.sql`), join(dir, `${e.tag}.sql`))
  writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  return dir
}

beforeAll(async () => {
  client = new PGlite()
  const db = drizzle(client)
  await migrate(db as never, { migrationsFolder: olderMigrations('0004_user_preference') })
  // Bestand vor der Migration: zwei Nutzer, je ein Upstream mit Secret und Tool
  await client.exec(`
    insert into "user" (id, name, email) values ('ua', 'A', 'a@x'), ('ub', 'B', 'b@x');
    insert into upstream (id, user_id, slug, name, type, url) values
      ('11111111-1111-4111-8111-111111111111', 'ua', 'one', 'One', 'http', 'https://a.example'),
      ('22222222-2222-4222-8222-222222222222', 'ub', 'one', 'One', 'http', 'https://b.example');
    insert into upstream_secret (user_id, upstream_id, kind, name, ciphertext) values
      ('ua', '11111111-1111-4111-8111-111111111111', 'bearer', '', 'v1.a'),
      ('ub', '22222222-2222-4222-8222-222222222222', 'bearer', '', 'v1.b');
    insert into upstream_tool (user_id, upstream_id, name) values
      ('ua', '11111111-1111-4111-8111-111111111111', 'echo'),
      ('ub', '22222222-2222-4222-8222-222222222222', 'echo');
  `)
  await migrate(db as never, { migrationsFolder: FULL })
})
afterAll(() => client.close())

describe('composite upstream foreign keys', () => {
  it('keeps the existing data', async () => {
    expect(await count('select count(*)::int n from upstream')).toBe(2)
    expect(await count('select count(*)::int n from upstream_secret')).toBe(2)
    expect(await count('select count(*)::int n from upstream_tool')).toBe(2)
  })
  it('refuses a secret or tool whose user differs from the upstream owner', async () => {
    const a = '11111111-1111-4111-8111-111111111111'
    await expect(client.query(`insert into upstream_secret (user_id, upstream_id, kind, name, ciphertext) values ('ub', '${a}', 'header', 'X-Key', 'v1.evil')`)).rejects.toThrow(/foreign key|violates/i)
    await expect(client.query(`insert into upstream_tool (user_id, upstream_id, name) values ('ub', '${a}', 'sneaky')`)).rejects.toThrow(/foreign key|violates/i)
    await expect(client.query(`update upstream_secret set user_id = 'ub' where upstream_id = '${a}'`)).rejects.toThrow(/foreign key|violates/i)
  })
  it('still accepts the owner and cascades when the upstream or the user is deleted', async () => {
    const a = '11111111-1111-4111-8111-111111111111'
    await client.query(`insert into upstream_tool (user_id, upstream_id, name) values ('ua', '${a}', 'second')`)
    await client.query(`delete from upstream where id = '${a}'`)
    expect(await count(`select count(*)::int n from upstream_secret where upstream_id = '${a}'`)).toBe(0)
    expect(await count(`select count(*)::int n from upstream_tool where upstream_id = '${a}'`)).toBe(0)
    await client.query(`delete from "user" where id = 'ub'`)
    expect(await count('select count(*)::int n from upstream_secret')).toBe(0)
    expect(await count('select count(*)::int n from upstream_tool')).toBe(0)
  })
})
