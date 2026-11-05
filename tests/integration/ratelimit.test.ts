import { afterAll, beforeAll, expect, it } from 'vitest'
import { api, createInstance, startServer, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst, { rateLimit: true })
})
afterAll(async () => {
  await srv?.stop()
  await inst?.cleanup()
})

it('mit aktivem Rate-Limit liefert Sign-in nach vielen Versuchen 429', async () => {
  const c = api(srv.url, '198.51.100.5')
  const codes: number[] = []
  for (let i = 0; i < 15; i++) {
    codes.push((await c.request('/api/auth/sign-in/email', { body: { email: 'a@example.com', password: 'falsch-falsch-123' } })).status)
  }
  expect(codes).toContain(429)
})
