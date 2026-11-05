import { describe, expect, it } from 'vitest'
import { uidHasProcesses } from '../../supervisor/main'

describe('uidHasProcesses (review L-f)', () => {
  it('sees the own process', async () => {
    expect(await uidHasProcesses(process.getuid!())).toBe(true)
  })
  it('a UID without processes is gone', async () => {
    expect(await uidHasProcesses(3_999_999_999)).toBe(false)
  })
  it('without /proc there is nothing to wait for', async () => {
    expect(await uidHasProcesses(process.getuid!(), '/nonexistent-proc-dir')).toBe(false)
  })
})
