// TEMPORÄRER STUB für server/db/schema/auth.ts (generiert von Better Auth in 0a).
// Beim Merge löschen; server/db/schema/gateway.ts importiert dann aus './auth'.
import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: text('role'),
  banned: boolean('banned').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
