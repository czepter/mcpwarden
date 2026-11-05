import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const entry = fileURLToPath(new URL('../../.output/server/index.mjs', import.meta.url))

export default async function setup() {
  if (!existsSync(entry)) throw new Error('Build missing: run `pnpm build` first')
  if (process.env.TEST_BACKEND === 'postgres') {
    const url = process.env.TEST_PG_ADMIN_URL ?? 'postgres://postgres:test@localhost:54329/postgres'
    const c = new pg.Client({ connectionString: url })
    await c.connect()
    await c.end()
  }
}
