import { afterAll, beforeAll, expect, it } from 'vitest'
import { createInstance, startServer, type TestInstance } from './harness'

let inst: TestInstance
beforeAll(async () => { inst = await createInstance() })
afterAll(async () => { await inst?.cleanup() })

it('Requests immediately after process start never see an unmigrated DB (A8)', async () => {
  const srv = await startServer(inst, { noWait: true })
  const statuses: number[] = []
  const end = Date.now() + 30_000
  let readyAt = 0
  // Fire immediately and in parallel until /readyz is ready.
  while (Date.now() < end && !readyAt) {
    const batch = await Promise.all(Array.from({ length: 10 }, async () => {
      try {
        const r = await fetch(`${srv.url}/api/auth/get-session`)
        statuses.push(r.status)
        const h = await fetch(`${srv.url}/healthz`)
        statuses.push(h.status)
        return (await fetch(`${srv.url}/readyz`)).status
      } catch { return 0 }
    }))
    if (batch.includes(200)) readyAt = Date.now()
  }
  await srv.stop()
  expect(readyAt).toBeGreaterThan(0)
  expect(statuses.length).toBeGreaterThan(0)
  expect(statuses.every(s => s === 200)).toBe(true)
  expect(srv.logs()).not.toMatch(/relation .* does not exist|no such table/i)
})
