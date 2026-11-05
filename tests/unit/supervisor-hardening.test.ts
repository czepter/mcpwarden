import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prepareDataDirs, purgeUserDir, UID_MAX, UID_MIN, UidMap, UnsafeDirectory } from '../../supervisor/users'

const me = process.getuid!()
const gid = process.getgid!()
const tmp = () => mkdtempSync(join(tmpdir(), 'mcpw-hard-'))

describe('UidMap.load validation (H2)', () => {
  const write = (body: unknown, mode = 0o600) => {
    const d = tmp()
    const f = join(d, '.uidmap')
    writeFileSync(f, JSON.stringify(body), { mode })
    chmodSync(f, mode)
    return f
  }
  it('rejects uid 0, uids below/above the range, duplicates and reserved uids', async () => {
    for (const users of [{ a: 0 }, { a: UID_MIN - 1 }, { a: UID_MAX + 1 }, { a: UID_MIN, b: UID_MIN }]) {
      await expect(new UidMap(write({ v: 1, next: UID_MIN + 5, users }), [], me).load()).rejects.toBeInstanceOf(UnsafeDirectory)
    }
    await expect(new UidMap(write({ v: 1, next: UID_MIN + 5, users: { a: 20007 } }), [20007], me).load()).rejects.toBeInstanceOf(UnsafeDirectory)
  })
  it('rejects a file with group/other bits or a foreign owner', async () => {
    await expect(new UidMap(write({ v: 1, next: UID_MIN, users: {} }, 0o644), [], me).load()).rejects.toBeInstanceOf(UnsafeDirectory)
    await expect(new UidMap(write({ v: 1, next: UID_MIN, users: {} }), [], me + 1).load()).rejects.toBeInstanceOf(UnsafeDirectory)
  })
  it('never hands out an already assigned uid after a load with a too-small "next"', async () => {
    const m = new UidMap(write({ v: 1, next: UID_MIN, users: { a: UID_MIN + 3 } }), [], me)
    await m.load()
    expect(await m.uidFor('b')).toBeGreaterThan(UID_MIN + 3)
  })
  it('prototype-like user ids are ordinary keys (L4)', async () => {
    const m = new UidMap(join(tmp(), '.uidmap'), [], me)
    const a = await m.uidFor('constructor')
    const b = await m.uidFor('__proto__')
    const c = await m.uidFor('toString')
    expect(new Set([a, b, c]).size).toBe(3)
    for (const u of [a, b, c]) { expect(Number.isInteger(u)).toBe(true); expect(u).toBeGreaterThanOrEqual(UID_MIN) }
    expect(m.lookup('hasOwnProperty')).toBeUndefined()
    expect(m.lookup('constructor')).toBe(a)
  })
})

describe('prepareDataDirs (H2)', () => {
  const opts = (dataDir: string) => ({ dataDir, rootUid: me, webUid: me, webGid: gid, stdio: true })
  it('creates stdio 0711 and pgdata 0700 and tightens a group-writable DATA_DIR', async () => {
    const d = tmp()
    chmodSync(d, 0o777)
    await prepareDataDirs(opts(d))
    const { statSync } = await import('node:fs')
    expect(statSync(d).mode & 0o777).toBe(0o755)
    expect(statSync(join(d, 'stdio')).mode & 0o777).toBe(0o711)
    expect(statSync(join(d, 'pgdata')).mode & 0o777).toBe(0o700)
  })
  it('refuses a DATA_DIR / stdio owned by someone else (web-owned DATA_DIR)', async () => {
    const d = tmp()
    await expect(prepareDataDirs({ ...opts(d), rootUid: me + 1 })).rejects.toBeInstanceOf(UnsafeDirectory)
    const e = tmp()
    mkdirSync(join(e, 'stdio'))
    await expect(prepareDataDirs({ ...opts(e), rootUid: me + 1 })).rejects.toBeInstanceOf(UnsafeDirectory)
  })
  it('refuses symlinked stdio and pgdata and does not touch the target', async () => {
    const target = tmp()
    chmodSync(target, 0o777)
    const d = tmp()
    symlinkSync(target, join(d, 'stdio'))
    await expect(prepareDataDirs(opts(d))).rejects.toBeInstanceOf(UnsafeDirectory)
    const e = tmp()
    mkdirSync(join(e, 'stdio'))
    symlinkSync(target, join(e, 'pgdata'))
    await expect(prepareDataDirs(opts(e))).rejects.toBeInstanceOf(UnsafeDirectory)
    const { statSync } = await import('node:fs')
    expect(statSync(target).mode & 0o777).toBe(0o777)
  })
  it('refuses a symlinked DATA_DIR itself', async () => {
    const real = tmp()
    const link = join(tmp(), 'data')
    symlinkSync(real, link)
    await expect(prepareDataDirs(opts(link))).rejects.toBeInstanceOf(UnsafeDirectory)
  })
})

describe('purgeUserDir (H3)', () => {
  it('restores permissions (chmod 000 dirs) before deleting', async () => {
    const d = tmp()
    const u = join(d, 'stdio', '20000')
    mkdirSync(join(u, 'sub', 'deep'), { recursive: true })
    writeFileSync(join(u, 'sub', 'deep', 'f'), 'x')
    chmodSync(join(u, 'sub', 'deep'), 0)
    chmodSync(join(u, 'sub'), 0)
    const { spawn } = await import('node:child_process')
    const run = (argv: string[]) => new Promise<number>(res => spawn(argv[0]!, argv.slice(1), { stdio: 'ignore' }).on('exit', c => res(c ?? 1)))
    // als root verhindert chmod 000 nichts; der Test ist dort trivial, aber der Aufruf muss trotzdem gelingen
    await purgeUserDir(d, 20000, run)
    const { existsSync } = await import('node:fs')
    expect(existsSync(u)).toBe(false)
  })
})
