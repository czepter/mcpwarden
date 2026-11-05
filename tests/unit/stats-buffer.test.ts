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
    await new Promise(r => setTimeout(r, 5))
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
    await b.flush(true)
    expect(got).toEqual([2])
  })
  it('stop flushes remainder', async () => {
    const got: number[] = []
    const b = new StatsBuffer({ batch: 2, write: async (r) => { got.push(r.length) } })
    for (let i = 0; i < 5; i++) b.push(row(i))
    await b.stop()
    expect(got.reduce((a, c) => a + c, 0)).toBe(5)
  })

  it('sync-throwing writer does not throw into push/flush; rows dropped after max attempts', async () => {
    const b = new StatsBuffer({ batch: 10, maxAttempts: 2, write: () => { throw new Error('sync') } })
    expect(() => b.push(row(1))).not.toThrow()
    await b.flush(true)
    await b.flush(true)
    expect(b.size).toBe(0)
    expect(b.dropped).toBe(1)
  })
  it('constraint-error batch: only the bad row is dropped', async () => {
    const written: number[] = []
    const b = new StatsBuffer({ batch: 10, write: async (rows) => {
      if (rows.some(r => r.tool === 'bad')) throw Object.assign(new Error('fk'), { code: '23503' })
      written.push(...rows.map(r => r.ts.getTime()))
    } })
    for (let i = 0; i < 7; i++) b.push({ ...row(i), tool: i === 4 ? 'bad' : 't' })
    await b.flush(true)
    expect(written.sort()).toEqual([0, 1, 2, 3, 5, 6])
    expect(b.dropped).toBe(1)
    expect(b.size).toBe(0)
  })
  it('hanging writer: flushing clears on timeout, buffer stays bounded', async () => {
    const b = new StatsBuffer({ batch: 5, max: 20, writeTimeoutMs: 30, maxAttempts: 100, write: () => new Promise(() => {}) })
    for (let i = 0; i < 200; i++) b.push(row(i))
    await new Promise(r => setTimeout(r, 80))
    expect(b.size).toBeLessThanOrEqual(20)
    b.push(row(999))
    expect(b.dropped).toBeGreaterThan(150)
  })
  it('stop() honours its overall deadline and counts leftovers', async () => {
    const b = new StatsBuffer({ batch: 100, stopDeadlineMs: 150, writeTimeoutMs: 5_000, write: () => new Promise(() => {}) })
    for (let i = 0; i < 5; i++) b.push(row(i))
    const t = Date.now()
    await b.stop()
    expect(Date.now() - t).toBeLessThan(1000)
    expect(b.dropped).toBe(5)
    expect(b.size).toBe(0)
  })
  it('strips NUL bytes and caps text length', async () => {
    let got: CallStatRow[] = []
    const b = new StatsBuffer({ write: async (r) => { got = r } })
    b.push({ ...row(1), tool: 'a\u0000b' + 'x'.repeat(1000) })
    await b.flush(true)
    expect(got[0]!.tool).not.toContain('\u0000')
    expect(got[0]!.tool!.length).toBe(256)
  })
})
