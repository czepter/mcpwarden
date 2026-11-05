import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import type { Db } from './index'

/**
 * Dev: <cwd>/server/db/migrations. Build: .output/server/migrations (copy hook in nuxt.config.ts).
 * Caution: in the Nitro bundle, `import.meta.url` is only the placeholder `file:///_entry.js` until the body of index.mjs runs. The Postgres path
 * migrates synchronously at plugin start (PGlite waits for `create` first) and therefore saw `/` as the folder; this went unnoticed in the repo cwd.
 * Hence additionally the folder of the start script (`.output/server/index.mjs`).
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
  if (!dir) throw new Error('migrations folder not found')
  return dir
}

/** Idempotent. Call only from getDb(). */
export async function runMigrations(db: Db, backend: 'pglite' | 'postgres'): Promise<void> {
  const migrationsFolder = resolveMigrationsDir()
  if (backend === 'pglite') {
    await migratePglite(db as never, { migrationsFolder })
  } else {
    await migratePg(db as never, { migrationsFolder })
  }
}
