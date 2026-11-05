import { sql } from 'drizzle-orm'
import { bigserial, boolean, check, foreignKey, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uuid, primaryKey } from 'drizzle-orm/pg-core'
import { user } from './auth'

const userFk = () => text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' })

export const upstream = pgTable('upstream', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userFk(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  url: text('url'),
  transport: text('transport').notNull().default('auto'),
  authType: text('auth_type').notNull().default('none'),
  authHeaderName: text('auth_header_name'),
  command: text('command'),
  args: jsonb('args').notNull().default(sql`'[]'::jsonb`),
  env: jsonb('env').notNull().default(sql`'{}'::jsonb`),
  cwd: text('cwd'),
  ratePerMin: integer('rate_per_min').notNull().default(60),
  maxConcurrent: integer('max_concurrent').notNull().default(5),
  timeouts: jsonb('timeouts'),
  status: text('status').notNull().default('unknown'),
  statusReason: text('status_reason'),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastOkAt: timestamp('last_ok_at', { withTimezone: true }),
  setup: text('setup').notNull().default('ready'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('upstream_user_slug_uq').on(t.userId, t.slug),
  // Target of the composite foreign keys of upstream_secret/upstream_tool: a row can never belong to another user's upstream
  unique('upstream_user_id_id_uq').on(t.userId, t.id),
  check('upstream_type_ck', sql`${t.type} in ('http','stdio')`),
  check('upstream_transport_ck', sql`${t.transport} in ('auto','streamable','sse')`),
  check('upstream_auth_type_ck', sql`${t.authType} in ('none','bearer','header','env')`),
  check('upstream_status_ck', sql`${t.status} in ('unknown','healthy','degraded','open','auth_expired','disabled')`),
  check('upstream_setup_ck', sql`${t.setup} in ('ready','awaiting_auth','awaiting_approval')`),
  check('upstream_slug_ck', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{0,31}$'`),
  check('upstream_http_url_ck', sql`${t.type} <> 'http' or ${t.url} is not null`),
  check('upstream_stdio_cmd_ck', sql`${t.type} <> 'stdio' or ${t.command} is not null`),
])

export const upstreamSecret = pgTable('upstream_secret', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userFk(),
  upstreamId: uuid('upstream_id').notNull(),
  kind: text('kind').notNull(),
  name: text('name').notNull().default(''),
  ciphertext: text('ciphertext').notNull(),
  keyVersion: smallint('key_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [
  unique('upstream_secret_uq').on(t.upstreamId, t.kind, t.name),
  foreignKey({ name: 'upstream_secret_user_upstream_fk', columns: [t.userId, t.upstreamId], foreignColumns: [upstream.userId, upstream.id] }).onDelete('cascade'),
  check('upstream_secret_kind_ck', sql`${t.kind} in ('bearer','header','env')`),
])

export const upstreamTool = pgTable('upstream_tool', {
  upstreamId: uuid('upstream_id').notNull(),
  name: text('name').notNull(),
  userId: userFk(),
  enabled: boolean('enabled').notNull().default(true),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  gone: boolean('gone').notNull().default(false),
}, t => [
  primaryKey({ columns: [t.upstreamId, t.name] }),
  foreignKey({ name: 'upstream_tool_user_upstream_fk', columns: [t.userId, t.upstreamId], foreignColumns: [upstream.userId, upstream.id] }).onDelete('cascade'),
])

export const userGatewayLimits = pgTable('user_gateway_limits', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  maxUpstreams: integer('max_upstreams').notNull().default(50),
  callsPerMin: integer('calls_per_min').notNull().default(120),
  maxConnections: integer('max_connections').notNull().default(20),
  stdioAllowed: boolean('stdio_allowed').notNull().default(false),
  stdioMaxProcs: integer('stdio_max_procs').notNull().default(5),
  stdioIdleMin: integer('stdio_idle_min').notNull().default(10),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Personal settings per user. If the row is missing, the defaults apply (notification on). */
export const userPreference = pgTable('user_preference', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  notifyStatusMail: boolean('notify_status_mail').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const userInvite = pgTable('user_invite', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  email: text('email'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  usedBy: text('used_by').references(() => user.id, { onDelete: 'set null' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  // deliberately without FK: entries survive deleting the user
  userId: text('user_id'),
  actor: text('actor').notNull(),
  clientId: text('client_id'),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  targetLabel: text('target_label'),
  scope: text('scope').notNull(),
  category: text('category').notNull(),
  result: text('result').notNull().default('success'),
  meta: jsonb('meta'),
}, t => [
  index('audit_log_user_idx').on(t.userId, t.id),
  index('audit_log_scope_idx').on(t.scope, t.id),
  check('audit_scope_ck', sql`${t.scope} in ('user','instance')`),
  check('audit_category_ck', sql`${t.category} in ('management','auth','status','denied')`),
  check('audit_result_ck', sql`${t.result} in ('success','denied','pending','status_change')`),
])

export const callStat = pgTable('call_stat', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  userId: userFk(),
  clientId: text('client_id'),
  tokenId: text('token_id'),
  upstreamId: uuid('upstream_id').references(() => upstream.id, { onDelete: 'set null' }),
  upstreamSlug: text('upstream_slug').notNull(),
  tool: text('tool'),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  totalMs: integer('total_ms').notNull(),
  upstreamMs: integer('upstream_ms'),
  overheadMs: integer('overhead_ms'),
  retries: smallint('retries').notNull().default(0),
  reqBytes: integer('req_bytes').notNull().default(0),
  resBytes: integer('res_bytes').notNull().default(0),
  cacheHit: boolean('cache_hit').notNull().default(false),
}, t => [
  index('call_stat_user_upstream_ts_idx').on(t.userId, t.upstreamId, t.ts),
  index('call_stat_ts_idx').on(t.ts),
  check('call_stat_kind_ck', sql`${t.kind} in ('list','call')`),
])
