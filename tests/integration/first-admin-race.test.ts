import { afterAll, beforeAll, expect, it } from 'vitest'
import { INVITE_REQUIRED } from '../../shared/api-types'
import { api, createInstance, startServer, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
})
afterAll(async () => {
  await srv?.stop()
  await inst?.cleanup()
})

it('10 parallele Erst-Registrierungen ergeben genau einen Admin (A9)', async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) =>
    api(srv.url, `203.0.113.${i + 1}`).request('/api/auth/sign-up/email', {
      body: { name: `U${i}`, email: `u${i}@example.com`, password: 'passwort-12345' },
    })))
  expect(rs.filter(r => r.status === 200)).toHaveLength(1)
  const closed = rs.filter(r => r.status === 403)
  expect(closed).toHaveLength(9)
  expect(closed.every(r => r.json.code === INVITE_REQUIRED)).toBe(true)
  const winner = rs.findIndex(r => r.status === 200)
  const c = api(srv.url)
  await c.request('/api/auth/sign-in/email', { body: { email: `u${winner}@example.com`, password: 'passwort-12345' } })
  const list = await c.request('/api/auth/admin/list-users?limit=50')
  expect(list.json.users).toHaveLength(1)
  expect(list.json.users[0].role).toBe('admin')
})
