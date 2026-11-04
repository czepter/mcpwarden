import { mkdtempSync, mkdirSync, symlinkSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeFrame, FrameError, FrameReader, MAX_CONTROL_FRAME, parseCommand } from '../../supervisor/protocol'
import { ensureUserDir, purgeUserDir, UID_MAX, UID_MIN, UidMap, UnsafeDirectory } from '../../supervisor/users'

const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'mcpw-uid-')); mkdirSync(join(d, 'stdio')); return d }

describe('uidmap', () => {
  it('assigns stable, sequential uids in range and persists across restart', async () => {
    const d = tmp(), f = join(d, 'stdio', '.uidmap')
    const m = new UidMap(f)
    const [a, b] = await Promise.all([m.uidFor('alice'), m.uidFor('bob')])
    expect(new Set([a, b]).size).toBe(2)
    expect(a).toBeGreaterThanOrEqual(UID_MIN)
    expect(await m.uidFor('alice')).toBe(a)
    expect(statSync(f).mode & 0o777).toBe(0o600)
    const m2 = new UidMap(f); await m2.load()
    expect(await m2.uidFor('bob')).toBe(b)
    expect(await m2.uidFor('carol')).toBeGreaterThan(Math.max(a, b))
  })
  it('concurrent requests for the same user get the same uid; never 0, never reserved web uid', async () => {
    const d = tmp()
    const m = new UidMap(join(d, 'stdio', '.uidmap'), [UID_MIN])
    const uids = await Promise.all(Array.from({ length: 20 }, () => m.uidFor('same')))
    expect(new Set(uids).size).toBe(1)
    expect(uids[0]).not.toBe(UID_MIN)
    expect(uids[0]).toBeGreaterThan(0)
  })
  it('uids are never reused (entries stay after purge); range exhaustion fails', async () => {
    const d = tmp()
    const m = new UidMap(join(d, 'stdio', '.uidmap'))
    const first = await m.uidFor('u1')
    await purgeUserDir(d, first, async () => 0)
    expect(await m.uidFor('u2')).not.toBe(first)
    ;(m as unknown as { data: { next: number } }).data.next = UID_MAX + 1
    await expect(m.uidFor('overflow')).rejects.toThrow('exhausted')
  })
  it('rejects invalid user ids', async () => {
    const m = new UidMap(join(tmp(), 'stdio', '.uidmap'))
    for (const bad of ['', '../x', 'a/b', 'a'.repeat(65), 'a b']) await expect(m.uidFor(bad)).rejects.toThrow()
  })
})

describe('ensureUserDir', () => {
  const noChown = { chown: async () => {} }
  it('creates a 0700 dir; second call is a no-op', async () => {
    const d = tmp()
    const dir = await ensureUserDir(d, process.getuid!(), noChown, process.getuid!())
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    await ensureUserDir(d, process.getuid!(), noChown, process.getuid!())
  })
  it('refuses a pre-existing symlink instead of following it', async () => {
    const d = tmp()
    const target = mkdtempSync(join(tmpdir(), 'mcpw-target-'))
    symlinkSync(target, join(d, 'stdio', '20000'))
    let chowned = false
    await expect(ensureUserDir(d, 20000, { chown: async () => { chowned = true } }, process.getuid!())).rejects.toBeInstanceOf(UnsafeDirectory)
    expect(chowned).toBe(false)
  })
  it('refuses a regular file at the path', async () => {
    const d = tmp()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(d, 'stdio', '20001'), 'x')
    await expect(ensureUserDir(d, 20001, noChown, process.getuid!())).rejects.toBeInstanceOf(UnsafeDirectory)
  })
})

describe('protocol', () => {
  it('frames roundtrip across chunk boundaries and enforce the size limit', () => {
    const r = new FrameReader(MAX_CONTROL_FRAME)
    const f = encodeFrame({ v: 1, cmd: 'ping' })
    expect(r.push(f.subarray(0, 3))).toEqual([])
    expect(r.push(f.subarray(3))).toEqual([{ v: 1, cmd: 'ping' }])
    expect(() => new FrameReader(100).push(Buffer.from([0, 0, 1, 0]))).toThrow(FrameError)
    expect(() => new FrameReader(100).push(Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from('{x')]))).toThrow(FrameError)
  })
  it('commands: strict fields, no uid/gid/cwd/path ever accepted', () => {
    expect(parseCommand({ v: 1, cmd: 'attach', userId: 'abc_-1', maxProcs: 5, idleMin: 10 })).toBeTruthy()
    for (const bad of [
      { v: 1, cmd: 'attach', userId: 'a', uid: 0 }, { v: 1, cmd: 'attach', userId: 'a', gid: 0 }, { v: 1, cmd: 'attach', userId: 'a', cwd: '../..' },
      { v: 1, cmd: 'attach', userId: '../etc' }, { v: 1, cmd: 'attach', userId: 'a/b' }, { v: 1, cmd: 'attach' }, { v: 2, cmd: 'ping' },
      { v: 1, cmd: 'chown' }, { v: 1, cmd: 'attach', userId: 'a', maxProcs: 0 }, { v: 1, cmd: 'attach', userId: 'a', maxProcs: 1e9 },
      { v: 1, cmd: 'stopWorker', userId: 'a', purge: 'yes' }, null, [], 'x',
    ]) expect(() => parseCommand(bad), JSON.stringify(bad)).toThrow(FrameError)
  })
  it('supervisor and worker bundles contain no MCP/SDK code and no secrets handling', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['supervisor/main.ts', 'supervisor/worker.ts', 'supervisor/users.ts', 'supervisor/protocol.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/@modelcontextprotocol|"jsonrpc"|process\.env\.(MASTER_KEY|DATABASE_URL|BETTER_AUTH)/)
    }
  })
})
