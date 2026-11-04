/**
 * Eigene Tabellen von Phase 0b (Migration 0002). Keine Tabellenpraefixe, Text-IDs fuer user.id.
 * Fremdschluessel auf `user` (0a) und `oauth_client` (Migration 0001).
 */
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
// TODO(merge 0a): auf `./auth` umstellen (user) bzw. den generierten OAuth-Client importieren.
import { oauthClient, user } from '../../_stubs/auth-schema'

/** Einzige Einstellungstabelle des Projekts (Phase 1 nutzt sie mit). Schluessel `oauth.dcr_mode`. */
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const dcrAllowlist = pgTable('dcr_allowlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  namePattern: text('name_pattern').notNull(),
  redirectPatterns: jsonb('redirect_patterns').$type<string[]>().notNull(),
  builtin: boolean('builtin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** `allowlisted` haelt den Stand bei der Registrierung; die API berechnet live neu. */
export const oauthClientMeta = pgTable('oauth_client_meta', {
  clientId: text('client_id').primaryKey().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  allowlisted: boolean('allowlisted').notNull(),
  registeredVia: text('registered_via', { enum: ['dcr', 'admin'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Letzter /mcp-Aufruf je (Nutzer, Client), gedrosselt geschrieben vom Zugriffs-Check. */
export const oauthConnectionUse = pgTable('oauth_connection_use', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.clientId] })])

export const personalAccessToken = pgTable('personal_access_token', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, t => [index('personal_access_token_user_idx').on(t.userId)])
