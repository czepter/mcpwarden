// Umstiegstest PGlite -> Postgres (P0-11, Abnahme 14): Dump der eingebetteten Datenbank, Import in Postgres,
// App startet mit DATABASE_URL und gleichem MASTER_KEY: Login, Upstreams, Tool-Filter, entschlüsselbares Secret,
// laufende Sequenzen, unveränderte Migrationstabelle. Läuft im Postgres-Lauf (`pnpm test:pg`, Docker nötig).
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PatCreated, UpstreamDetail } from '#shared/api-types'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { ADMIN, api, backend, signUpFirstAdmin, startServer, type TestInstance } from './harness'

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres:test@localhost:54329/postgres'
const KEY = Buffer.from(randomBytes(32)).toString('hex')

describe.skipIf(backend !== 'postgres')('PGlite -> Postgres switch', () => {
  let fake: FakeHttp
  let src: TestInstance
  let dbName: string
  let dbUrl: string
  const dir: { path: string } = { path: '' }

  beforeAll(async () => {
    fake = await startFakeHttp()
    fake.requireHeader('authorization', 'Bearer sekret-upstream-token')
    dir.path = await mkdtemp(join(tmpdir(), 'mcpw-switch-'))
  })
  afterAll(async () => {
    await fake.close()
    await rm(dir.path, { recursive: true, force: true })
    if (src) await rm(src.dataDir, { recursive: true, force: true })
    if (dbName) {
      const c = new pg.Client({ connectionString: ADMIN_URL })
      await c.connect()
      await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
      await c.end()
    }
  })

  it('dump -> import -> app starts on DATABASE_URL with login, upstream, filter, decryptable secret', async () => {
    // 1. Quelle: PGlite (kein DATABASE_URL), befüllt über die echte API
    src = { dataDir: await mkdtemp(join(tmpdir(), 'mcpw-src-')), cleanup: async () => {} }
    const s1 = await startServer(src, { env: { MASTER_KEY: KEY, DATABASE_URL: undefined } })
    const admin = await signUpFirstAdmin(s1)
    await admin.request('/api/admin/settings', { method: 'PUT', body: { 'ssrf.allow': ['127.0.0.0/8'] } })
    const up = (await admin.request('/api/upstreams', { body: { name: 'Fake', slug: 'fake', type: 'http', url: fake.url, authType: 'bearer' } })).json as UpstreamDetail
    await admin.request(`/api/upstreams/${up.id}/secret`, { method: 'PUT', body: { kind: 'bearer', value: 'sekret-upstream-token' } })
    expect(((await admin.request(`/api/upstreams/${up.id}/test`, { method: 'POST', body: {} })).json as { ok: boolean }).ok).toBe(true)
    await admin.request(`/api/upstreams/${up.id}/tools/add`, { method: 'PUT', body: { enabled: false } })
    for (let i = 0; i < 3; i++) await admin.request('/api/me/pats', { body: { name: `t${i}` } })
    await new Promise(r => setTimeout(r, 5500)) // Stats flushen
    expect(await s1.stop()).toBe(0)

    // 2. Dump mit dem mitgelieferten Werkzeug
    execFileSync('node', ['scripts/build-supervisor.mjs'], { stdio: 'ignore' })
    const dump = spawnSync('node', ['dist/tools/pglite-dump.mjs', src.dataDir], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    expect(dump.status, dump.stderr).toBe(0)
    const sqlFile = join(dir.path, 'dump.sql')
    await writeFile(sqlFile, dump.stdout)
    expect(dump.stdout).toContain('upstream_secret')
    expect(dump.stdout).not.toContain('sekret-upstream-token') // Secrets liegen nur verschlüsselt im Dump

    // 3. Import in leere Postgres-Datenbank
    dbName = `mcpwarden_sw_${randomBytes(4).toString('hex')}`
    const root = new pg.Client({ connectionString: ADMIN_URL })
    await root.connect()
    await root.query(`CREATE DATABASE ${dbName}`)
    await root.end()
    const u = new URL(ADMIN_URL); u.pathname = `/${dbName}`; dbUrl = u.toString()
    const imp = spawnSync('docker', ['run', '--rm', '-i', '--network', 'host', 'postgres:17', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', dbUrl], { input: dump.stdout, encoding: 'utf8' })
    expect(imp.status, imp.stderr).toBe(0)
    const before = await new pg.Client({ connectionString: dbUrl }).connect().then(async (c) => { const r = await c.query('select count(*)::int n from drizzle.__drizzle_migrations'); await c.end(); return r.rows[0].n as number })

    // 4. App auf Postgres, gleicher MASTER_KEY, neue DATA_DIR
    const target: TestInstance = { dataDir: await mkdtemp(join(tmpdir(), 'mcpw-dst-')), databaseUrl: dbUrl, cleanup: async () => {} }
    const s2 = await startServer(target, { env: { MASTER_KEY: KEY } })
    try {
      const c = api(s2.url)
      expect((await c.request('/api/auth/sign-in/email', { body: { email: ADMIN.email, password: ADMIN.password } })).status).toBe(200)
      const list = (await c.request('/api/upstreams')).json as { items: UpstreamDetail[] }
      expect(list.items.map(x => x.slug)).toEqual(['fake'])
      expect(list.items[0]).toMatchObject({ hasSecret: true, setup: 'ready' })
      const tools = (await c.request(`/api/upstreams/${up.id}/tools`)).json as { items: Array<{ name: string, enabled: boolean }> }
      expect(tools.items.find(t => t.name === 'add')?.enabled).toBe(false) // Tool-Filter überlebt
      // Secret ist mit dem gleichen Master-Key entschlüsselbar: der Fake-Upstream verlangt den Bearer
      expect(((await c.request(`/api/upstreams/${up.id}/test`, { method: 'POST', body: {} })).json as { ok: boolean }).ok).toBe(true)
      const pat = (await c.request('/api/me/pats', { body: { name: 'after' } })).json as PatCreated
      const mcp = new Client({ name: 't', version: '1' })
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s2.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${pat.token}` } } }))
      const r = await mcp.callTool({ name: 'fake__echo', arguments: { text: 'migriert' } })
      expect((r.content as Array<{ text: string }>)[0]!.text).toBe('migriert')
      await mcp.close()
      await new Promise(r => setTimeout(r, 5500))
      // Sequenzen laufen weiter: neue Stats-/Audit-Zeilen ohne Schlüsselkonflikt
      const pc = new pg.Client({ connectionString: dbUrl })
      await pc.connect()
      const stats = await pc.query('select count(*)::int n from call_stat')
      expect(stats.rows[0].n).toBeGreaterThan(0)
      const mig = await pc.query('select count(*)::int n from drizzle.__drizzle_migrations')
      expect(mig.rows[0].n).toBe(before) // kein Migrationslauf
      await pc.end()
      // neue Registrierung per Einladung möglich
      const inv = (await c.request('/api/admin/invites', { body: {} })).json as { link: string }
      const res = await fetch(`${s2.url}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: s2.url, 'x-invite-token': inv.link.split('/invite/')[1]! }, body: JSON.stringify({ name: 'N', email: 'n@example.com', password: 'passwort-1234567' }) })
      expect(res.status).toBe(200)
    } finally {
      expect(await s2.stop()).toBe(0)
      await rm(target.dataDir, { recursive: true, force: true })
    }
  }, 180_000)
})
