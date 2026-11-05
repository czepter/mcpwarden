/**
 * Schreibt einen SQL-Dump der eingebetteten PGlite-Datenbank nach stdout (Umstieg auf Postgres, P0-11).
 * Aufruf (App gestoppt): node dist/tools/pglite-dump.mjs [DATA_DIR]   (Standard: $DATA_DIR oder ./data)
 * Import: psql -v ON_ERROR_STOP=1 -f dump.sql in eine leere Datenbank, dann die App mit DATABASE_URL
 * und dem GLEICHEN MASTER_KEY starten.
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
