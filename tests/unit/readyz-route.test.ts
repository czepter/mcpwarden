// Review L-b: /readyz prueft den Supervisor, wenn stdio aktiv ist.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = { migrated: true, draining: false, ping: undefined as undefined | (() => Promise<boolean>) }
vi.mock('../../server/utils/ready', () => ({ isReady: () => state.migrated }))
vi.mock('../../server/gateway/runtime', () => ({ isDraining: () => state.draining, statsDropped: () => 3, supervisorPing: () => state.ping }))

const status = vi.fn()
let handler: (e: unknown) => Promise<Record<string, unknown>>

beforeEach(async () => {
  Object.assign(state, { migrated: true, draining: false, ping: undefined })
  status.mockReset()
  vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
  vi.stubGlobal('setResponseStatus', status)
  handler = (await import('../../server/routes/readyz.get')).default as never
})
afterEach(() => { vi.unstubAllGlobals() })

describe('/readyz', () => {
  it('ready without stdio (no supervisor to ask)', async () => {
    expect(await handler({})).toEqual({ ready: true, stats_dropped: 3 })
    expect(status).not.toHaveBeenCalled()
  })
  it('ready when the supervisor answers', async () => {
    state.ping = async () => true
    expect(await handler({})).toMatchObject({ ready: true })
    expect(status).not.toHaveBeenCalled()
  })
  it('503 when stdio is enabled and the supervisor does not answer', async () => {
    state.ping = async () => false
    expect(await handler({})).toMatchObject({ ready: false, status: 'not_ready' })
    expect(status).toHaveBeenCalledWith({}, 503)
  })
  it('503 when the supervisor ping throws', async () => {
    state.ping = async () => { throw new Error('socket') }
    expect(await handler({})).toMatchObject({ ready: false })
    expect(status).toHaveBeenCalledWith({}, 503)
  })
  it('not migrated and draining stay 503', async () => {
    state.migrated = false
    expect(await handler({})).toMatchObject({ ready: false, status: 'not_ready' })
    state.migrated = true; state.draining = true
    expect(await handler({})).toMatchObject({ ready: false, status: 'draining' })
  })
})
