// Review L-e (defense in depth): an auth kind without a matching secret never connects silently without an auth header.
import { describe, expect, it, vi } from 'vitest'
import { connectUpstream } from '../../server/gateway/upstream/connect'
import { classifyError } from '../../server/gateway/upstream/errors'
import type { UpstreamRow } from '../../server/gateway/upstream/types'

const up = (over: Partial<UpstreamRow>) => ({ id: 'i', userId: 'u', type: 'http', url: 'https://example.com/mcp', transport: 'streamable', authType: 'header', authHeaderName: 'X-New', timeouts: null, version: 1, ...over }) as UpstreamRow

describe('connectUpstream without matching credentials', () => {
  for (const [name, row, creds] of [
    ['header secret stored under the old name', up({}), { headers: { 'X-Old': 'v' } }],
    ['bearer without secret', up({ authType: 'bearer', authHeaderName: null }), {}],
  ] as const) {
    it(name, async () => {
      const safeFetch = vi.fn()
      const err = await connectUpstream(row, { safeFetch: safeFetch as never, credentials: async () => creds }).catch(e => e)
      expect(safeFetch).not.toHaveBeenCalled()
      expect(classifyError(err)).toMatchObject({ code: 'awaiting_auth', counts: false })
    })
  }
})
