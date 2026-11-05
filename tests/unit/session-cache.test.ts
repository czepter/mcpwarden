import { describe, expect, it } from 'vitest'
import { SessionCache } from '../../server/gateway/stdio/session-cache'

const mk = () => ({ closed: false, closes: 0, close() { this.closed = true; this.closes++ } })

describe('SessionCache (review M-D: first stdio attach race)', () => {
  it('parallel first connects of one user share a single attach', async () => {
    const c = new SessionCache<ReturnType<typeof mk>>()
    let attaches = 0
    const attach = async () => { attaches++; await new Promise(r => setTimeout(r, 20)); return mk() }
    const all = await Promise.all([c.get('u', attach), c.get('u', attach), c.get('u', attach), c.get('u', attach)])
    expect(attaches).toBe(1)
    expect(new Set(all).size).toBe(1)
  })
  it('an open session is reused, a closed one is replaced', async () => {
    const c = new SessionCache<ReturnType<typeof mk>>()
    let attaches = 0
    const attach = async () => { attaches++; return mk() }
    const a = await c.get('u', attach)
    expect(await c.get('u', attach)).toBe(a)
    a.closed = true
    const b = await c.get('u', attach)
    expect(b).not.toBe(a)
    expect(attaches).toBe(2)
  })
  it('users are independent', async () => {
    const c = new SessionCache<ReturnType<typeof mk>>()
    const [a, b] = await Promise.all([c.get('a', async () => mk()), c.get('b', async () => mk())])
    expect(a).not.toBe(b)
  })
  it('a failed attach is not remembered: the next call tries again, all waiters see the error', async () => {
    const c = new SessionCache<ReturnType<typeof mk>>()
    let n = 0
    const attach = async () => { n++; await new Promise(r => setTimeout(r, 10)); if (n === 1) throw new Error('boom'); return mk() }
    const rs = await Promise.allSettled([c.get('u', attach), c.get('u', attach)])
    expect(rs.map(r => r.status)).toEqual(['rejected', 'rejected'])
    expect(n).toBe(1)
    expect((await c.get('u', attach)).closed).toBe(false)
    expect(n).toBe(2)
  })
  it('close(user) and closeAll() close and forget sessions', async () => {
    const c = new SessionCache<ReturnType<typeof mk>>()
    const a = await c.get('a', async () => mk())
    const b = await c.get('b', async () => mk())
    c.close('a')
    expect(a.closes).toBe(1)
    expect((await c.get('a', async () => mk()))).not.toBe(a)
    c.closeAll()
    expect(b.closes).toBe(1)
  })
})
