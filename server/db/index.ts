// Exactly one DB client per process. Switching only via DATABASE_URL (P0-11).
// Rules: no PGlite-specific SQL, no extensions, no long transactions,
// no casing flag (the generated schema names columns explicitly).
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
// globalThis protects against a double instance during dev HMR.
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

/** Resolves only after the migration. If it fails, the promise stays rejected. */
export function getDb(): Promise<Db> {
  if (!g.__mcpwDb) {
    // Set the placeholder synchronously so that parallel callers share the same promise.
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

/** Idempotent; resets the state. */
export async function closeDb(): Promise<void> {
  const s = g.__mcpwDb
  if (!s) return
  g.__mcpwDb = undefined
  await s.close()
}
