import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectUpstream } from '../../server/gateway/upstream/connect'
import { classifyError } from '../../server/gateway/upstream/errors'
import { createSafeFetch } from '../../server/gateway/net/safe-fetch'
import { MemoryStore } from '../helpers/memory-store'

let conns = 0
let port = 0
const server = createServer((_q, r) => { r.writeHead(200).end('{}') })
beforeAll(async () => { server.on('connection', () => { conns++ }); await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); port = (server.address() as AddressInfo).port })
afterAll(() => server.close())

describe('real transports are blocked by safe-fetch (proves the fetch option is honoured)', () => {
  for (const transport of ['streamable', 'sse'] as const) {
    it(`${transport}: private target never receives a connection`, async () => {
      conns = 0
      const store = new MemoryStore()
      const up = store.addUpstream('A', { slug: 'x', url: `http://127.0.0.1:${port}/mcp`, transport })
      const safeFetch = createSafeFetch()
      const err = await connectUpstream(up, { safeFetch, credentials: async () => ({}) }).catch(e => e)
      expect(classifyError(err).code).toBe('ssrf_blocked')
      expect(classifyError(err).message).not.toMatch(/127\.0\.0\.1/)
      expect(conns).toBe(0)
      await safeFetch.close()
    })
  }
  it('auto fallback does not mask an SSRF block', async () => {
    conns = 0
    const up = new MemoryStore().addUpstream('A', { slug: 'x', url: `http://localhost:${port}/mcp`, transport: 'auto' })
    const err = await connectUpstream(up, { safeFetch: createSafeFetch(), credentials: async () => ({}) }).catch(e => e)
    expect(classifyError(err).code).toBe('ssrf_blocked')
    expect(conns).toBe(0)
  })
})
