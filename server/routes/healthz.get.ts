import { sql } from 'drizzle-orm'
import { getDb } from '../db'

export default defineEventHandler(async (event) => {
  try {
    await (await getDb()).execute(sql`select 1`)
    return { ok: true }
  } catch {
    setResponseStatus(event, 503)
    return { ok: false }
  }
})
