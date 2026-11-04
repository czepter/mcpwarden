import { afterEach, describe, expect, it, vi } from 'vitest'

describe('getMasterKey', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })
  it('liefert 32 Byte aus MASTER_KEY', async () => {
    vi.stubEnv('BASE_URL', 'http://localhost:3000')
    vi.stubEnv('BETTER_AUTH_SECRET', 's'.repeat(32))
    vi.stubEnv('MASTER_KEY', 'cd'.repeat(32))
    const { getMasterKey } = await import('../../server/utils/master-key')
    expect(getMasterKey().equals(Buffer.from('cd'.repeat(32), 'hex'))).toBe(true)
  })
})
