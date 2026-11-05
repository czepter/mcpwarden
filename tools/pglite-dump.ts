/**
 * Writes an SQL dump of the embedded PGlite database to stdout (switching to Postgres, P0-11).
 * Usage (app stopped): node dist/tools/pglite-dump.mjs [DATA_DIR]   (default: $DATA_DIR or ./data)
 * Import: psql -v ON_ERROR_STOP=1 -f dump.sql into an empty database, then start the app with DATABASE_URL
 * and the SAME MASTER_KEY.
 */
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgDump } from '@electric-sql/pglite-tools/pg_dump'

const dataDir = process.argv[2] ?? process.env.DATA_DIR ?? './data'
const db = await PGlite.create(join(dataDir, 'pgdata'))
try {
  const file = await pgDump({ pg: db, args: ['--no-owner', '--no-acl'] })
  process.stdout.write(await file.text())
} finally {
  await db.close()
}
