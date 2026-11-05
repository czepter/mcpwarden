import { beforeEach, describe, expect, it } from 'vitest'
import { createLogger, maskPath, redact } from '../../server/utils/logger'
import { registerLifecycleHandler, resetLifecycleHandlers, runUserDeleted, runUserDisabled, setLifecycleErrorSink } from '../../server/utils/user-lifecycle'
import { liveness, readiness } from '../../server/gateway/health'

describe('logger redaction', () => {
  it('redacts sensitive keys (nested) and masks invite paths', () => {
    const out: string[] = []
    createLogger(l => out.push(l)).info('GET /invite/abc123TOKEN ok', { headers: { Authorization: 'Bearer sk-1', 'X-Invite-Token': 'tok', accept: 'x' }, upstream: { secret: 's', ciphertext: 'c', name: 'n' }, url: '/api/invites/ZZZ?x=1' })
    const line = out.join('')
    for (const leak of ['sk-1', 'abc123TOKEN', '"tok"', 'ZZZ', '"s"']) expect(line).not.toContain(leak)
    expect(line).toContain('accept')
    expect(maskPath('/api/invites/T/x')).toBe('/api/invites/[token]/x')
    expect(redact(new Error('/invite/SECRETTOKEN failed'))).toEqual({ name: 'Error', message: '/invite/[token] failed' })
  })
})

describe('user lifecycle registry', () => {
  beforeEach(() => resetLifecycleHandlers())
  it('runs sequentially in registration order; an error does not stop the others', async () => {
    const order: string[] = []
    const errs: string[] = []
    setLifecycleErrorSink(n => errs.push(n))
    registerLifecycleHandler({ name: 'a', onUserDisabled: async () => { await new Promise(r => setTimeout(r, 10)); order.push('a') } })
    registerLifecycleHandler({ name: 'b', onUserDisabled: () => { throw new Error('x') } })
    registerLifecycleHandler({ name: 'c', onUserDisabled: () => { order.push('c') }, onUserDeleted: () => { order.push('del') } })
    await runUserDisabled('u')
    await runUserDeleted('u')
    expect(order).toEqual(['a', 'c', 'del'])
    expect(errs).toEqual(['b'])
  })
})

describe('health logic', () => {
  it('liveness depends only on SELECT 1', async () => {
    expect((await liveness(async () => 1)).status).toBe(200)
    expect((await liveness(async () => { throw new Error('db') })).status).toBe(503)
  })
  it('readiness: migrated, draining, supervisor', async () => {
    expect((await readiness({ migrated: true, draining: false })).status).toBe(200)
    expect((await readiness({ migrated: false, draining: false })).body.status).toBe('not_ready')
    expect((await readiness({ migrated: true, draining: true })).body.status).toBe('draining')
    expect((await readiness({ migrated: true, draining: false, supervisorPing: async () => true })).status).toBe(200)
    expect((await readiness({ migrated: true, draining: false, supervisorPing: async () => false })).status).toBe(503)
    expect((await readiness({ migrated: true, draining: false, supervisorPing: async () => { throw new Error('x') } })).status).toBe(503)
  })
})
