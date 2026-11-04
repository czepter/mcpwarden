/**
 * TEMPORAER (Phase 0b Teil 1): Platzhalter fuer Tabellen, die erst 0a (`user`, generiert in
 * `server/db/schema/auth.ts`) und Migration 0001 (`oauth_client`, generiert aus `mcp()`) liefern.
 * Nur als Typ-/FK-Ziel fuer `server/db/schema/mcp.ts`. Beim Merge mit 0a ersetzen: den Import in
 * `mcp.ts` auf `./auth` umstellen und diese Datei loeschen. Wird nie migriert.
 */
import { pgTable, text } from 'drizzle-orm/pg-core'

export const user = pgTable('user', { id: text('id').primaryKey() })
// Annahme (Spike offen): Better Auth haelt die oeffentliche client_id in der Spalte `client_id`.
export const oauthClient = pgTable('oauth_client', { clientId: text('client_id').primaryKey() })
