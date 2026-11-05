import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { pushSchema } from 'drizzle-kit/api'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as auth from '../../server/db/schema/auth'
import * as gw from '../../server/db/schema/gateway'

// Schema test without migration files (migrations only arrive with the 0a tooling): tables are pushed directly.
let client: PGlite
let db: ReturnType<typeof drizzle>
beforeAll(async () => {
  client = new PGlite()
  db = drizzle(client)
  const { apply } = await pushSchema({ ...auth, ...gw }, db as never)
  await apply()
})
afterAll(() => client.close())

describe('gateway schema', () => {
  it('constraints: slug regex, unique (user, slug), http needs url, stdio needs command', async () => {
    await db.insert(auth.user).values({ id: 'u1', name: 'n', email: 'a@x' })
    const base = { userId: 'u1', name: 'x', type: 'http', url: 'https://x' }
    await db.insert(gw.upstream).values({ ...base, slug: 'ok' })
    await expect(db.insert(gw.upstream).values({ ...base, slug: 'ok' })).rejects.toThrow()
    await expect(db.insert(gw.upstream).values({ ...base, slug: 'Bad_Slug' })).rejects.toThrow()
    await expect(db.insert(gw.upstream).values({ ...base, slug: 'nourl', url: null })).rejects.toThrow()
    await expect(db.insert(gw.upstream).values({ ...base, slug: 'nocmd', type: 'stdio' })).rejects.toThrow()
    await db.insert(auth.user).values({ id: 'u2', name: 'n', email: 'b@x' })
    await db.insert(gw.upstream).values({ ...base, userId: 'u2', slug: 'ok' }) // same slug, different user
  })
  it('deleting a user cascades to upstreams, secrets, tools, limits, call_stat; audit_log stays', async () => {
    await db.insert(auth.user).values({ id: 'del', name: 'n', email: 'd@x' })
    const [up] = await db.insert(gw.upstream).values({ userId: 'del', slug: 'gone', name: 'g', type: 'http', url: 'https://x' }).returning()
    await db.insert(gw.upstreamSecret).values({ userId: 'del', upstreamId: up!.id, kind: 'bearer', ciphertext: 'v1.x.y.z' })
    await db.insert(gw.upstreamTool).values({ userId: 'del', upstreamId: up!.id, name: 't' })
    await db.insert(gw.userGatewayLimits).values({ userId: 'del' })
    await db.insert(gw.callStat).values({ userId: 'del', upstreamId: up!.id, upstreamSlug: 'gone', kind: 'call', status: 'ok', totalMs: 1 })
    await db.insert(gw.auditLog).values({ userId: 'del', actor: 'admin:x', action: 'user.deleted', targetType: 'user', scope: 'instance', category: 'management' })
    await db.delete(auth.user).where(sql`id = 'del'`)
    for (const t of ['upstream', 'upstream_secret', 'upstream_tool', 'user_gateway_limits', 'call_stat']) {
      const r = await client.query(`select count(*)::int as n from ${t} where user_id = 'del'`)
      expect((r.rows[0] as { n: number }).n, t).toBe(0)
    }
    expect(((await client.query(`select count(*)::int as n from audit_log where user_id = 'del'`)).rows[0] as { n: number }).n).toBe(1)
  })
  it('secret uniqueness per (upstream, kind, name); audit enums enforced', async () => {
    const [up] = await db.select().from(gw.upstream).limit(1)
    await db.insert(gw.upstreamSecret).values({ userId: up!.userId, upstreamId: up!.id, kind: 'header', name: 'X-Key', ciphertext: 'c' })
    await expect(db.insert(gw.upstreamSecret).values({ userId: up!.userId, upstreamId: up!.id, kind: 'header', name: 'X-Key', ciphertext: 'c' })).rejects.toThrow()
    await expect(db.insert(gw.auditLog).values({ actor: 'system', action: 'a', targetType: 't', scope: 'weird', category: 'management' })).rejects.toThrow()
  })
})
