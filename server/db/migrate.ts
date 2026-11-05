import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import type { Db } from './index'

/**
 * Dev: <cwd>/server/db/migrations. Build: .output/server/migrations (Kopierhook in nuxt.config.ts).
 * Achtung: Im Nitro-Bundle ist `import.meta.url` bis zum Rumpf von index.mjs nur der Platzhalter `file:///_entry.js`. Der Postgres-Pfad
 * migriert synchron beim Plugin-Start (PGlite wartet vorher auf `create`) und sah deshalb `/` als Ordner; im Repo-cwd fiel das nicht auf.
 * Darum zusaetzlich der Ordner des Startskripts (`.output/server/index.mjs`).
 */
export function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const entry = process.argv[1] ? dirname(resolve(process.argv[1])) : here
  const candidates = [
    join(entry, 'migrations'),
    join(here, 'migrations'),
    join(here, '..', 'migrations'),
    join(here, '..', '..', 'migrations'),
    resolve(process.cwd(), 'server/db/migrations'),
  ]
  const dir = candidates.find(c => existsSync(join(c, 'meta', '_journal.json')))
  if (!dir) throw new Error('Migrationsordner nicht gefunden')
  return dir
}

/** Idempotent. Nur aus getDb() aufrufen. */
export async function runMigrations(db: Db, backend: 'pglite' | 'postgres'): Promise<void> {
  const migrationsFolder = resolveMigrationsDir()
  if (backend === 'pglite') {
    await migratePglite(db as never, { migrationsFolder })
  } else {
    await migratePg(db as never, { migrationsFolder })
  }
}
