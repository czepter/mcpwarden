import { afterAll, beforeAll, expect, it } from 'vitest'
import { createInstance, startServer, type TestInstance } from './harness'

let inst: TestInstance
beforeAll(async () => { inst = await createInstance() })
afterAll(async () => { await inst?.cleanup() })

const SECRET = 'SECRET-VALUE-DO-NOT-LOG'

async function fails(env: Record<string, string | undefined>, name: string) {
  const srv = await startServer(inst, { env, noWait: true })
  const code = await Promise.race([srv.exited, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 20_000))])
  if (code === 'timeout') await srv.stop()
  expect(code).not.toBe(0)
  expect(code).not.toBe('timeout')
  expect(srv.logs()).toContain(name)
  expect(srv.logs()).not.toContain(SECRET)
}

it('without MASTER_KEY: exit != 0, message names the variable', () => fails({ MASTER_KEY: undefined }, 'MASTER_KEY'))
it('short BETTER_AUTH_SECRET', () => fails({ BETTER_AUTH_SECRET: 'short' }, 'BETTER_AUTH_SECRET'))
it('http:// BASE_URL outside localhost', () => fails({ BASE_URL: 'http://example.com' }, 'BASE_URL'))
it('wrong MASTER_KEY is not logged', () => fails({ MASTER_KEY: SECRET }, 'MASTER_KEY'))

it('SMTP_URL without MAIL_FROM: exit != 0, credentials are not logged', () =>
  fails({ SMTP_URL: `smtp://user:${SECRET}@mail.example.com:587`, MAIL_FROM: undefined }, 'MAIL_FROM'))
it('invalid SMTP_URL: exit != 0, credentials are not logged', () =>
  fails({ SMTP_URL: `http://user:${SECRET}@mail.example.com`, MAIL_FROM: 'a@example.com' }, 'SMTP_URL'))
