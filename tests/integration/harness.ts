// Gemeinsamer Test-Harness fuer 0a, 0b und Phase 1 (Signaturen stabil halten).
// Startet das gebaute Artefakt als Kindprozess. Nur hier kennt der Test den Backend-Unterschied
// (TEST_BACKEND=pglite|postgres, TEST_PG_ADMIN_URL); der Server sieht nur, ob DATABASE_URL gesetzt ist.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'

const ENTRY = fileURLToPath(new URL('../../.output/server/index.mjs', import.meta.url))
export const backend = (process.env.TEST_BACKEND ?? 'pglite') as 'pglite' | 'postgres'
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres:test@localhost:54329/postgres'

/** Persistenter Zustand (DATA_DIR bzw. Datenbank), ueberlebt Neustarts des Servers. */
export interface TestInstance {
  dataDir: string
  databaseUrl?: string
  cleanup: () => Promise<void>
}

export async function createInstance(): Promise<TestInstance> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mcpw-test-'))
  if (backend === 'pglite') return { dataDir, cleanup: () => rm(dataDir, { recursive: true, force: true }) }
  const name = `mcpwarden_${randomBytes(6).toString('hex')}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()
  const u = new URL(ADMIN_URL)
  u.pathname = `/${name}`
  return {
    dataDir,
    databaseUrl: u.toString(),
    cleanup: async () => {
      await rm(dataDir, { recursive: true, force: true })
      const c = new pg.Client({ connectionString: ADMIN_URL })
      await c.connect()
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await c.end()
    },
  }
}

/** Anzahl angewandter Migrationen (bei PGlite auf gestoppter Instanz). */
export async function countMigrations(inst: TestInstance): Promise<number> {
  const q = 'select count(*)::int as n from drizzle.__drizzle_migrations'
  if (inst.databaseUrl) {
    const c = new pg.Client({ connectionString: inst.databaseUrl })
    await c.connect()
    try {
      return (await c.query(q)).rows[0].n
    } finally {
      await c.end()
    }
  }
  const db = await PGlite.create(join(inst.dataDir, 'pgdata'))
  try {
    return ((await db.query<{ n: number }>(q)).rows[0]!).n
  } finally {
    await db.close()
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

export interface TestServer {
  url: string
  port: number
  proc: ChildProcess
  logs: () => string
  exited: Promise<number | null>
  /** SIGTERM, wartet auf Exit, liefert den Exit-Code. */
  stop: () => Promise<number | null>
  waitReady: (timeoutMs?: number) => Promise<void>
}

export interface StartOptions {
  /** Ueberschreibt/loescht (undefined) Umgebungsvariablen. Default-Satz siehe unten. */
  env?: Record<string, string | undefined>
  /** Default: RATE_LIMIT=off. */
  rateLimit?: boolean
  /** Ohne Warten auf /readyz zurueckgeben (Race-Tests). */
  noWait?: boolean
  port?: number
}

export async function startServer(inst: TestInstance, opts: StartOptions = {}): Promise<TestServer> {
  const port = opts.port ?? await freePort()
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    BASE_URL: `http://localhost:${port}`,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    MASTER_KEY: 'ab'.repeat(32),
    DATA_DIR: inst.dataDir,
    DATABASE_URL: inst.databaseUrl,
    ...(opts.rateLimit ? {} : { RATE_LIMIT: 'off' }),
    ...opts.env,
  }
  const cleanEnv = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as NodeJS.ProcessEnv
  const proc = spawn(process.execPath, [ENTRY], { env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout!.on('data', d => (out += d))
  proc.stderr!.on('data', d => (out += d))
  const exited = new Promise<number | null>(res => proc.once('exit', code => res(code)))
  const url = `http://localhost:${port}`
  const srv: TestServer = {
    url,
    port,
    proc,
    logs: () => out,
    exited,
    stop: async () => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
      return exited
    },
    waitReady: async (timeoutMs = 30_000) => {
      const end = Date.now() + timeoutMs
      while (Date.now() < end) {
        if (proc.exitCode !== null) throw new Error(`Server beendet (${proc.exitCode}): ${out}`)
        try {
          if ((await fetch(`${url}/readyz`)).status === 200) return
        } catch { /* noch nicht erreichbar */ }
        await new Promise(r => setTimeout(r, 50))
      }
      throw new Error(`Server nicht bereit: ${out}`)
    },
  }
  if (!opts.noWait) await srv.waitReady()
  return srv
}

/** HTTP-Client mit Cookie-Jar; sendet Origin und eine feste Client-IP (fuer Rate-Limit-Tests). */
export function api(baseUrl: string, ip = '203.0.113.7') {
  const jar = new Map<string, string>()
  async function request(path: string, init: { method?: string, body?: unknown } = {}) {
    const res = await fetch(baseUrl + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'origin': baseUrl,
        'x-forwarded-for': ip,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    for (const c of res.headers.getSetCookie()) {
      const [pair = ''] = c.split(';')
      const i = pair.indexOf('=')
      const k = pair.slice(0, i)
      const v = pair.slice(i + 1)
      if (v === '' || /Max-Age=0/i.test(c)) jar.delete(k)
      else jar.set(k, v)
    }
    const text = await res.text()
    let json: any // eslint-disable-line @typescript-eslint/no-explicit-any
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: res.status, json, text }
  }
  return { request, jar }
}
export type ApiClient = ReturnType<typeof api>

export const ADMIN = { name: 'Admin', email: 'admin@example.com', password: 'admin-passwort-123' }

/** Registriert den ersten Nutzer (wird Admin) und liefert den angemeldeten Client. */
export async function signUpFirstAdmin(srv: TestServer, user = ADMIN): Promise<ApiClient> {
  const c = api(srv.url)
  const r = await c.request('/api/auth/sign-up/email', { body: user })
  if (r.status !== 200) throw new Error(`Erst-Registrierung fehlgeschlagen: ${r.status} ${r.text}`)
  return c
}

/** Legt einen weiteren Nutzer ueber die Admin-API an (nie ueber die oeffentliche Registrierung). */
export async function createUser(
  admin: ApiClient,
  user: { name: string, email: string, password: string, role?: 'user' | 'admin' },
) {
  const r = await admin.request('/api/auth/admin/create-user', { body: { role: 'user', ...user } })
  if (r.status !== 200) throw new Error(`createUser fehlgeschlagen: ${r.status} ${r.text}`)
  return r.json.user as { id: string, email: string, role: string }
}
