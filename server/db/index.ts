// Genau ein DB-Client pro Prozess. Umschaltung nur per DATABASE_URL (P0-11).
// Regeln: kein PGlite-spezifisches SQL, keine Extensions, keine langen Transaktionen,
// kein casing-Flag (generiertes Schema benennt Spalten explizit).
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { getConfig } from '../utils/config'
import { runMigrations } from './migrate'
import * as schema from './schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>

interface State {
  promise: Promise<Db>
  close: () => Promise<void>
}
// globalThis schuetzt vor Doppelinstanz bei Dev-HMR.
const g = globalThis as typeof globalThis & { __mcpwDb?: State }

export const dbBackend: 'pglite' | 'postgres' = process.env.DATABASE_URL?.trim() ? 'postgres' : 'pglite'

async function init(): Promise<State> {
  const cfg = getConfig()
  let db: Db
  let close: () => Promise<void>
  if (!cfg.databaseUrl) {
    const client = await PGlite.create(join(cfg.dataDir, 'pgdata'))
    db = drizzlePglite({ client, schema }) as unknown as Db
    close = () => client.close()
  } else {
    const pool = new pg.Pool({ connectionString: cfg.databaseUrl })
    db = drizzlePg(pool, { schema }) as unknown as Db
    close = () => pool.end()
  }
  try {
    await runMigrations(db, cfg.databaseUrl ? 'postgres' : 'pglite')
  } catch (e) {
    await close().catch(() => {})
    throw e
  }
  return { promise: Promise.resolve(db), close }
}

/** Loest erst nach der Migration auf. Schlaegt sie fehl, bleibt das Promise rejected. */
export function getDb(): Promise<Db> {
  if (!g.__mcpwDb) {
    // Platzhalter synchron setzen, damit parallele Aufrufer dasselbe Promise teilen.
    let resolveState!: (s: State) => void
    let rejectState!: (e: unknown) => void
    const stateP = new Promise<State>((res, rej) => {
      resolveState = res
      rejectState = rej
    })
    stateP.catch(() => {})
    const promise = stateP.then(s => s.promise)
    g.__mcpwDb = { promise, close: async () => (await stateP.catch(() => undefined))?.close() }
    init().then(resolveState, rejectState)
  }
  return g.__mcpwDb.promise
}

/** Idempotent; setzt den Zustand zurueck. */
export async function closeDb(): Promise<void> {
  const s = g.__mcpwDb
  if (!s) return
  g.__mcpwDb = undefined
  await s.close()
}
