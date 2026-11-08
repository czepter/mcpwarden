/**
 * Own tables of phase 0b (migration 0002). No table prefixes, text IDs for user.id.
 * Foreign keys to `user` (0a) and `oauth_client` (migration 0001).
 */
import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { oauthClient, user } from './auth'

/** The project's only settings table (phase 1 uses it too). Key `oauth.dcr_mode`. */
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

/** `allowlisted` holds the state at registration; the API recomputes it live. */
export const oauthClientMeta = pgTable('oauth_client_meta', {
  clientId: text('client_id').primaryKey().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  allowlisted: boolean('allowlisted').notNull(),
  registeredVia: text('registered_via', { enum: ['dcr', 'admin'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Last /mcp call per (user, client), written throttled by the access check. */
export const oauthConnectionUse = pgTable('oauth_connection_use', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.clientId] })])

/** Optional device label of an OAuth connection (user + client), e.g. derived from the user agent at consent. */
export const oauthConnectionDevice = pgTable('oauth_connection_device', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  deviceName: text('device_name').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.userId, t.clientId] })])

export const personalAccessToken = pgTable('personal_access_token', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Optional device label entered at creation (max 64 characters). */
  deviceName: text('device_name'),
  tokenHash: text('token_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  /** null = never expires */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** null = all upstreams of the user; otherwise only these upstream IDs */
  upstreamIds: uuid('upstream_ids').array(),
}, t => [index('personal_access_token_user_idx').on(t.userId)])
