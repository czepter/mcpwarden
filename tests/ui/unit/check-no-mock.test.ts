import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error reines JS-Modul
import { findMock } from '../check-no-mock.mjs'

describe('check-no-mock', () => {
  it('meldet Mock-Dateien und -Code, ignoriert sauberen Build', () => {
    const clean = mkdtempSync(join(tmpdir(), 'clean-')); mkdirSync(join(clean, 'public'))
    writeFileSync(join(clean, 'public', 'a.js'), 'console.log(1)')
    expect(findMock(clean)).toEqual([])
    const dirty = mkdtempSync(join(tmpdir(), 'dirty-')); mkdirSync(join(dirty, 'public'))
    writeFileSync(join(dirty, 'public', 'mockServiceWorker.js'), '//')
    writeFileSync(join(dirty, 'x.mjs'), 'startMock()')
    expect(findMock(dirty)).toHaveLength(2)
  })
})
