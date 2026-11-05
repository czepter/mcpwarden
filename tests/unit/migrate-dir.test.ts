import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveMigrationsDir } from '../../server/db/migrate'

describe('Migrations folder in the build', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('is found via the start script, even if neither import.meta.url nor cwd point to the build', () => {
    const out = mkdtempSync(join(tmpdir(), 'mcpw-mig-'))
    mkdirSync(join(out, 'server/migrations/meta'), { recursive: true })
    writeFileSync(join(out, 'server/migrations/meta/_journal.json'), '{}')
    vi.spyOn(process, 'cwd').mockReturnValue('/nonexistent-cwd')
    const argv = process.argv[1]
    process.argv[1] = join(out, 'server/index.mjs')
    try { expect(resolveMigrationsDir()).toBe(join(out, 'server/migrations')) } finally { process.argv[1] = argv! }
  })
})
