import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import type { Db } from './index'

/** Dev: <cwd>/server/db/migrations. Build: .output/server/migrations (Kopierhook in nuxt.config.ts). */
export function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
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
