// Gemeinsamer Test-Harness fuer 0a, 0b und Phase 1 (Signaturen stabil halten).
// Startet das gebaute Artefakt als Kindprozess. Nur hier kennt der Test den Backend-Unterschied
// (TEST_BACKEND=pglite|postgres, TEST_PG_ADMIN_URL); der Server sieht nur, ob DATABASE_URL gesetzt ist.
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
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
    MCPW_DUMMY_UPSTREAM: '1', // 0b-Tests nutzen den Dummy-Upstream neben dem echten Gateway
    DATABASE_URL: inst.databaseUrl,
    // Der Test-Client spielt den Reverse-Proxy: sein X-Forwarded-For (ein Eintrag) gilt als Client-IP. Tests zu TRUST_PROXY ueberschreiben das.
    TRUST_PROXY: 'true',
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
  return { request, jar, baseUrl }
}
export type ApiClient = ReturnType<typeof api>

/**
 * POST, dessen Header sofort gesendet werden, dessen Body aber zurueckgehalten wird, bis `release()` aufgerufen wird.
 * So lassen sich mehrere Anfragen deterministisch gleichzeitig "in der Luft" halten: der Server hat jeden Aufrufer angemeldet,
 * bevor irgendeine Aktion committet (Tests auf Gleichzeitigkeit duerfen nicht von Ankunftszeiten abhaengen).
 */
export function heldPost(baseUrl: string, client: ApiClient, path: string, body: unknown, ip = '203.0.113.7') {
  const u = new URL(baseUrl + path)
  const payload = JSON.stringify(body)
  const cookie = [...client.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const req = httpRequest({
    host: u.hostname, port: u.port, path: u.pathname, method: 'POST',
    headers: { 'origin': baseUrl, 'x-forwarded-for': ip, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...(cookie ? { cookie } : {}) },
  })
  const done = new Promise<{ status: number, json: any, text: string }>((resolve, reject) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    req.on('error', reject)
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c as Buffer))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json: any // eslint-disable-line @typescript-eslint/no-explicit-any
        try { json = JSON.parse(text) } catch { json = undefined }
        resolve({ status: res.statusCode ?? 0, json, text })
      })
    })
  })
  req.flushHeaders()
  return { release: () => { req.end(payload); return done } }
}

export const ADMIN = { name: 'Admin', email: 'admin@example.com', password: 'admin-passwort-123' }

/** Registriert den ersten Nutzer (wird Admin) und liefert den angemeldeten Client. */
export async function signUpFirstAdmin(srv: TestServer, user = ADMIN): Promise<ApiClient> {
  const c = api(srv.url)
  const r = await c.request('/api/auth/sign-up/email', { body: user })
  if (r.status !== 200) throw new Error(`Erst-Registrierung fehlgeschlagen: ${r.status} ${r.text}`)
  return c
}

let signUpIp = 0

/**
 * Legt einen weiteren Nutzer an, wie es ein Admin im Betrieb tut: Einladung ueber die mcpwarden-Admin-Route, Registrierung mit dem Token.
 * Die Better-Auth-Admin-Endpunkte sind per HTTP gesperrt (server/auth/http-guard.ts) und dienen nie als Testhilfe.
 */
export async function createUser(
  admin: ApiClient,
  user: { name: string, email: string, password: string },
) {
  const inv = await admin.request('/api/admin/invites', { body: { email: user.email } })
  if (inv.status !== 201) throw new Error(`createUser: Einladung fehlgeschlagen: ${inv.status} ${inv.text}`)
  const token = (inv.json.link as string).split('/invite/')[1]!
  const ip = `198.18.${Math.floor(signUpIp / 250) % 250}.${(signUpIp++ % 250) + 1}`
  const res = await fetch(`${admin.baseUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': admin.baseUrl, 'x-forwarded-for': ip, 'x-invite-token': token },
    body: JSON.stringify(user),
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`createUser fehlgeschlagen: ${res.status} ${text}`)
  const u = JSON.parse(text).user as { id: string, email: string }
  return { id: u.id, email: u.email, role: 'user' }
}

/**
 * Macht einen Nutzer zum Admin. Im Produkt gibt es dafuer keine Route (nur der erste Nutzer wird Admin), Tests mit mehreren Admins
 * schreiben die Rolle deshalb direkt in die Datenbank. PGlite erlaubt nur einen Prozess: der Server wird dafuer gestoppt und
 * auf demselben Port mit denselben Optionen neu gestartet (Sitzungen liegen in der Datenbank und bleiben gueltig).
 */
export async function promoteToAdmin(inst: TestInstance, srv: TestServer, email: string, opts: StartOptions = {}): Promise<TestServer> {
  await srv.stop()
  const sql = 'update "user" set role = \'admin\' where email = $1'
  if (inst.databaseUrl) {
    const c = new pg.Client({ connectionString: inst.databaseUrl })
    await c.connect()
    try { await c.query(sql, [email]) } finally { await c.end() }
  } else {
    const db = await PGlite.create(join(inst.dataDir, 'pgdata'))
    try { await db.query(sql, [email]) } finally { await db.close() }
  }
  return startServer(inst, { ...opts, port: srv.port })
}
