import { describe, expect, it } from 'vitest'
import { StatsBuffer, type CallStatRow } from '../../server/gateway/stats/buffer'

const row = (i: number): CallStatRow => ({ ts: new Date(i), userId: 'u', clientId: null, tokenId: null, upstreamId: null, upstreamSlug: 's', tool: 't', kind: 'call', status: 'ok', totalMs: 1, upstreamMs: 1, overheadMs: 0, retries: 0, reqBytes: 1, resBytes: 1, cacheHit: false })

describe('stats buffer', () => {
  it('batches at threshold without awaiting the DB in push', async () => {
    const written: number[] = []
    const b = new StatsBuffer({ batch: 3, write: async (r) => { written.push(r.length) } })
    for (let i = 0; i < 3; i++) b.push(row(i))
    await b.flush()
    expect(written).toEqual([3])
  })
  it('DB down: push stays fast, overflow drops oldest and counts', async () => {
    let calls = 0
    const b = new StatsBuffer({ max: 10, batch: 5, write: () => { calls++; return new Promise(() => {}) } })
    const t = performance.now()
    for (let i = 0; i < 100; i++) b.push(row(i))
    expect(performance.now() - t).toBeLessThan(50)
    expect(calls).toBe(1)
    expect(b.size).toBeLessThanOrEqual(10)
    expect(b.dropped).toBeGreaterThan(80)
  })
  it('flush error is swallowed, rows are retried', async () => {
    let fail = true
    const got: number[] = []
    const logs: string[] = []
    const b = new StatsBuffer({ batch: 10, log: m => logs.push(m), write: async (r) => { if (fail) throw new Error('x'); got.push(r.length) } })
    b.push(row(1)); b.push(row(2))
    await b.flush()
    expect(logs).toHaveLength(1)
    fail = false
    await b.flush()
    expect(got).toEqual([2])
  })
  it('stop flushes remainder', async () => {
    const got: number[] = []
    const b = new StatsBuffer({ batch: 2, write: async (r) => { got.push(r.length) } })
    for (let i = 0; i < 5; i++) b.push(row(i))
    await b.stop()
    expect(got.reduce((a, c) => a + c, 0)).toBe(5)
  })
})
