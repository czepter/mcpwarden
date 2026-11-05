import { afterAll, beforeAll, expect, it } from 'vitest'
import { createInstance, startServer, type TestInstance } from './harness'

let inst: TestInstance
beforeAll(async () => { inst = await createInstance() })
afterAll(async () => { await inst?.cleanup() })

const SECRET = 'GEHEIMER-WERT-NICHT-LOGGEN'

async function fails(env: Record<string, string | undefined>, name: string) {
  const srv = await startServer(inst, { env, noWait: true })
  const code = await Promise.race([srv.exited, new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 20_000))])
  if (code === 'timeout') await srv.stop()
  expect(code).not.toBe(0)
  expect(code).not.toBe('timeout')
  expect(srv.logs()).toContain(name)
  expect(srv.logs()).not.toContain(SECRET)
}

it('ohne MASTER_KEY: Exit != 0, Meldung nennt die Variable', () => fails({ MASTER_KEY: undefined }, 'MASTER_KEY'))
it('kurzes BETTER_AUTH_SECRET', () => fails({ BETTER_AUTH_SECRET: 'kurz' }, 'BETTER_AUTH_SECRET'))
it('http:// BASE_URL ausserhalb localhost', () => fails({ BASE_URL: 'http://example.com' }, 'BASE_URL'))
it('falscher MASTER_KEY wird nicht geloggt', () => fails({ MASTER_KEY: SECRET }, 'MASTER_KEY'))

it('SMTP_URL ohne MAIL_FROM: Exit != 0, Zugangsdaten werden nicht geloggt', () =>
  fails({ SMTP_URL: `smtp://user:${SECRET}@mail.example.com:587`, MAIL_FROM: undefined }, 'MAIL_FROM'))
it('ungueltige SMTP_URL: Exit != 0, Zugangsdaten werden nicht geloggt', () =>
  fails({ SMTP_URL: `http://user:${SECRET}@mail.example.com`, MAIL_FROM: 'a@example.com' }, 'SMTP_URL'))
