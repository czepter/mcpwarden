// Review M-F: Catalog.list no longer follows nextCursor without bound.
import type { Tool } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'
import { Catalog, CatalogLimitError } from '../../server/gateway/upstream/catalog'
import { classifyError } from '../../server/gateway/upstream/errors'
import type { UpstreamRow } from '../../server/gateway/upstream/types'

const tool = (name: string, extra = ''): Tool => ({ name, description: extra, inputSchema: { type: 'object' } }) as Tool
const up = (over: Partial<UpstreamRow> = {}) => ({ id: 'u1', userId: 'o', slug: 's', version: 1, timeouts: null, ...over }) as UpstreamRow

function make(pages: (cursor: string | undefined, signal: AbortSignal | undefined) => Promise<{ tools: Tool[], nextCursor?: string }>, limits = {}) {
  const synced: string[][] = []
  const calls = { pages: 0 }
  const pool = { get: async () => ({ client: { listTools: async (p: { cursor?: string } | undefined, o: { signal?: AbortSignal }) => { calls.pages++; return pages(p?.cursor, o.signal) } } }) }
  const store = { syncTools: async (_u: string, _id: string, names: string[]) => { synced.push(names); return new Map() } }
  return { cat: new Catalog({ pool: pool as never, store: store as never, limits }), synced, calls }
}

describe('Catalog.list bounds', () => {
  it('a normal paged list is collected and synced', async () => {
    const { cat, synced } = make(async c => (c === undefined ? { tools: [tool('a')], nextCursor: '1' } : { tools: [tool('b')] }))
    const r = await cat.list(up())
    expect(r.tools.map(t => t.name)).toEqual(['a', 'b'])
    expect(synced).toEqual([['a', 'b']])
  })
  it('endless paging stops at the page limit with a clean error and syncs nothing', async () => {
    let n = 0
    const { cat, synced, calls } = make(async () => ({ tools: [tool(`t${n++}`)], nextCursor: `c${n}` }), { maxPages: 5 })
    await expect(cat.list(up())).rejects.toBeInstanceOf(CatalogLimitError)
    expect(calls.pages).toBe(5)
    expect(synced).toHaveLength(0)
  })
  it('a repeating cursor is cut off', async () => {
    const { cat } = make(async () => ({ tools: [tool('a')], nextCursor: 'same' }))
    await expect(cat.list(up())).rejects.toThrow(/cursor/)
  })
  it('too many tools', async () => {
    const { cat, synced } = make(async c => ({ tools: Array.from({ length: 60 }, (_, i) => tool(`${c ?? 'x'}-${i}`)), nextCursor: `${(c ?? '') + 'y'}` }), { maxTools: 100 })
    await expect(cat.list(up())).rejects.toThrow(/tools/)
    expect(synced).toHaveLength(0)
  })
  it('too many bytes (huge descriptions)', async () => {
    let n = 0
    const { cat } = make(async () => ({ tools: [tool(`big${n}`, 'x'.repeat(20_000))], nextCursor: `n${n++}` }), { maxBytes: 50_000 })
    await expect(cat.list(up())).rejects.toThrow(/bytes/)
  })
  it('one time budget for the whole list: slow pages cannot add up past listMs', async () => {
    let n = 0
    const { cat } = make(async (_c, signal) => {
      await new Promise<void>((res, rej) => {
        const t = setTimeout(res, 60)
        signal?.addEventListener('abort', () => { clearTimeout(t); rej(signal.reason) })
      })
      return { tools: [tool(`t${n++}`)], nextCursor: `c${n}` }
    })
    const t0 = Date.now()
    await expect(cat.list(up({ timeouts: { listMs: 200 } }))).rejects.toThrow()
    expect(Date.now() - t0).toBeLessThan(1500)
  })
  it('the limit error is classified as a protocol problem that counts for the breaker, without leaking details', () => {
    const c = classifyError(new CatalogLimitError('more than 5 pages'))
    expect(c).toMatchObject({ code: 'protocol', counts: true, auth: false })
    expect(c.message).not.toMatch(/Seiten/)
  })
})
