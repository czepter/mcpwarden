import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('scripts/init-env.sh', () => {
  const setup = () => {
    const d = mkdtempSync(join(tmpdir(), 'mcpw-env-'))
    mkdirSync(join(d, 'scripts'))
    copyFileSync(resolve('scripts/init-env.sh'), join(d, 'scripts/init-env.sh'))
    copyFileSync(resolve('.env.example'), join(d, '.env.example'))
    return d
  }
  it('creates .env with mode 600 and fresh random secrets that pass the config rules', () => {
    const d = setup()
    execFileSync('sh', [join(d, 'scripts/init-env.sh')], { stdio: 'ignore', env: { ...process.env, UMASK: '' } })
    expect(statSync(join(d, '.env')).mode & 0o777).toBe(0o600)
    const env = readFileSync(join(d, '.env'), 'utf8')
    expect(env).toMatch(/^BETTER_AUTH_SECRET=.{32,}$/m)
    expect(env).toMatch(/^MASTER_KEY=[A-Za-z0-9+/]{43}=$/m)
  })
  it('is mode 600 even under a permissive umask, leaves no temp file, and never overwrites', () => {
    const d = setup()
    execFileSync('sh', ['-c', `umask 000 && sh ${join(d, 'scripts/init-env.sh')}`], { stdio: 'ignore' })
    expect(statSync(join(d, '.env')).mode & 0o777).toBe(0o600)
    writeFileSync(join(d, '.env'), 'keep')
    chmodSync(join(d, '.env'), 0o600)
    execFileSync('sh', [join(d, 'scripts/init-env.sh')], { stdio: 'ignore' })
    expect(readFileSync(join(d, '.env'), 'utf8')).toBe('keep')
    expect(execFileSync('ls', ['-A', d], { encoding: 'utf8' }).split('\n').filter(n => /^\.env\./.test(n) && n !== '.env.example')).toEqual([])
  })
})
