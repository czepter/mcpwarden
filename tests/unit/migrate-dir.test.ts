import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMigrationsDir } from '../../server/db/migrate'

describe('Migrationsordner im Build', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('wird ueber das Startskript gefunden, auch wenn weder import.meta.url noch cwd auf den Build zeigen', () => {
    const out = mkdtempSync(join(tmpdir(), 'mcpw-mig-'))
    mkdirSync(join(out, 'server/migrations/meta'), { recursive: true })
    writeFileSync(join(out, 'server/migrations/meta/_journal.json'), '{}')
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd')
    const argv = process.argv[1]
    process.argv[1] = join(out, 'server/index.mjs')
    try { expect(resolveMigrationsDir()).toBe(join(out, 'server/migrations')) } finally { process.argv[1] = argv! }
  })
})
