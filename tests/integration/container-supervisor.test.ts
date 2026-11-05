import { execFileSync, spawnSync } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'

// Linux-specific (UID switch, capabilities, /proc): runs only in the container (`pnpm test:container`, Docker required).
const IMAGE = 'node:24-bookworm-slim'
const dockerOk = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
const R: Record<string, unknown> = {}
let nocaps: Record<string, unknown> = {}
const parse = (out: string) => Object.assign({}, ...out.split('\n').filter(l => l.startsWith('RESULT ')).map(l => JSON.parse(l.slice(7)) as object))

describe.skipIf(!dockerOk)('supervisor in container (root, caps SETUID/SETGID/CHOWN only)', () => {
  let out = ''
  beforeAll(() => {
    execFileSync('node', ['scripts/build-supervisor.mjs'], { stdio: 'ignore' })
    const r = spawnSync('docker', ['run', '--rm', '--name', 'mcpw-1-sup-test', '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'CHOWN', '-v', `${process.cwd()}:/work:ro`, IMAGE, 'sh', '/work/tests/container/driver.sh'], { encoding: 'utf8', timeout: 170_000 })
    out = r.stdout + r.stderr
    Object.assign(R, parse(r.stdout))
    const n = spawnSync('docker', ['run', '--rm', '--name', 'mcpw-1-sup-nocaps', '--cap-drop', 'ALL', '--user', '10001:10001', '--tmpfs', '/data:uid=10001,gid=10001', '--tmpfs', '/run/mcpwarden:uid=10001,gid=10001', '-e', 'DATA_DIR=/data', '-e', 'SUP_SOCKET=/run/mcpwarden/sup.sock', '-e', 'FAKE_MODE=nocaps', '-e', 'WEB_CMD=["node","/work/tests/container/fake-web.mjs"]', '-v', `${process.cwd()}:/work:ro`, IMAGE, 'node', '/work/dist/supervisor/main.mjs'], { encoding: 'utf8', timeout: 60_000 })
    nocaps = parse(n.stdout)
  }, 200_000)

  it('completes the whole scenario', () => { expect(out).toContain('DONE') })
  it('web app runs unprivileged: CapEff = 0, uid 10001', () => { expect(R.webCapEff).toBe('0000000000000000'); expect(R.webUid).toBe(10001) })
  it('capability probe says canSwitchUser', () => { expect(R.capabilities).toMatchObject({ canSwitchUser: true }) })
  it('forged commands are rejected (uid 0, cwd, bad userId, unknown cmd, oversize frame)', () => {
    for (const k of ['forge_uid', 'forge_cwd', 'forge_userId_slash', 'forge_unknown_cmd']) expect(R[k], k).toBe('bad_command')
    expect(R.forge_big_frame).toBe(true)
  })
  it('worker child: supervisor-assigned uid, no group 0, clean env', () => {
    const c = R.childA as { uid: number, uidOk: boolean, groupsHaveZero: boolean, hasMy: boolean, leaksMaster: boolean, envKeys: string[], cwd: string }
    expect(c.uidOk).toBe(true)
    expect(c.groupsHaveZero).toBe(false)
    expect(R.idG).toBe(String(c.uid)) // `id -G`: only the own group
    expect(c.leaksMaster).toBe(false)
    expect(c.hasMy).toBe(true)
    expect(c.envKeys.filter(k => k !== 'SHLVL')).toEqual(['HOME', 'MY_SECRET', 'PATH', 'PWD', 'TMPDIR']) // SHLVL is set by bash
    expect(R.uidDiffers).toBe(true)
  })
  it('isolation: A cannot read B or pgdata; web cannot touch stdio', () => {
    expect(R.A_reads_B).toBe('EACCES'); expect(R.A_reads_pgdata).toBe('EACCES')
    expect(R.web_mkdir_stdio).toBe('EACCES'); expect(R.web_rename).toBe('EACCES'); expect(R.web_reads_user_dir).toBe('EACCES')
  })
  it('symlink attack: root changes no owner/mode outside the user dir', () => {
    expect(R.reattachA).toMatchObject({ ok: true })
    expect(R.symlink_untouched).toBe(true)
  })
  it('limits: child count, cwd escape, fork bomb confined to the user', () => {
    expect(R.child_limit).toBe(1)
    expect(R.cwd_escape).toBe('bad_cwd'); expect(R.cwd_abs).toBe('bad_cwd')
    expect((R.forkbomb as { err: number }).err).toBeGreaterThan(100)
    expect(R.B_after_bomb).toBe('alive')
  })
  it('lifecycle: busy, EOF on stop, backoff after crash, idle exit, purge', () => {
    expect(R.busy).toBe('busy'); expect(R.worker_exit_eof).toBe(true)
    expect(R.backoff).toBe('backoff'); expect(R.after_backoff).toBe(true)
    expect(R.idle_exit).toBe(true); expect(R.purged).toBe(true)
  })
  it('without capabilities (non-root): canSwitchUser=false, worker runs under the own uid', () => {
    expect(nocaps.capabilities).toMatchObject({ canSwitchUser: false })
    expect(nocaps.child_uid).toBe(10001)
  })
})
