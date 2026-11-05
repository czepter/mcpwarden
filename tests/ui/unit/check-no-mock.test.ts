import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error pure JS module
import { findMock } from '../check-no-mock.mjs'

describe('check-no-mock', () => {
  it('reports mock files and code, ignores a clean build', () => {
    const clean = mkdtempSync(join(tmpdir(), 'clean-')); mkdirSync(join(clean, 'public'))
    writeFileSync(join(clean, 'public', 'a.js'), 'console.log(1)')
    expect(findMock(clean)).toEqual([])
    const dirty = mkdtempSync(join(tmpdir(), 'dirty-')); mkdirSync(join(dirty, 'public'))
    writeFileSync(join(dirty, 'public', 'mockServiceWorker.js'), '//')
    writeFileSync(join(dirty, 'x.mjs'), 'startMock()')
    expect(findMock(dirty)).toHaveLength(2)
  })
  it('reports control keys and styleguide route of the mock build', () => {
    const d = mkdtempSync(join(tmpdir(), 'keys-'))
    writeFileSync(join(d, 'a.js'), 'localStorage.getItem("mockRole")')
    writeFileSync(join(d, 'b.js'), '{path:"/__styleguide"}')
    expect(findMock(d)).toHaveLength(2)
  })
  it('Script fails with exit code 1 on mock code and 2 without a build directory', () => {
    const run = (dir: string) => spawnSync(process.execPath, ['tests/ui/check-no-mock.mjs', dir], { encoding: 'utf8' })
    const dirty = mkdtempSync(join(tmpdir(), 'cli-dirty-'))
    writeFileSync(join(dirty, 'mockServiceWorker.js'), '//')
    expect(run(dirty).status).toBe(1)
    expect(run(join(dirty, 'gibtsnicht')).status).toBe(2)
    const clean = mkdtempSync(join(tmpdir(), 'cli-clean-'))
    expect(run(clean).status).toBe(0)
  })
})
