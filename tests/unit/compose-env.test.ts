// Spec P0-10: the example compose passes the documented variables through to the container (otherwise SMTP_URL stays stuck on the host,
// the mailer is never active in the container) and the slim check runs in CI.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const compose = readFileSync('compose.yaml', 'utf8')
const service = compose.split(/^ {2}postgres:/m)[0]!

describe('compose.yaml', () => {
  for (const v of ['BASE_URL', 'BETTER_AUTH_SECRET', 'MASTER_KEY', 'DATABASE_URL', 'ALLOWED_ORIGINS', 'STDIO_MODE', 'TRUST_PROXY', 'SMTP_URL', 'MAIL_FROM', 'MAIL_NOTIFY_WINDOW_MIN']) {
    it(`passes ${v} to the app service`, () => expect(service).toMatch(new RegExp(`^ {6}${v}: \\$\\{${v}`, 'm')))
  }
  it('every ENV variable of the README table that the app reads is passed (except test-only RATE_LIMIT and DATA_DIR)', () => {
    const readme = readFileSync('README.md', 'utf8')
    const documented = [...readme.matchAll(/^\| `([A-Z_]+)` \|/gm)].map(m => m[1]!).filter(v => !['RATE_LIMIT', 'DATA_DIR'].includes(v))
    for (const v of documented) expect(service, v).toContain(`${v}:`)
  })
})

describe('slim smoke script', () => {
  it('builds and starts the slim image and checks that stdio is locked (run locally: pnpm test:slim)', () => {
    const script = readFileSync('tests/e2e/slim-smoke.sh', 'utf8')
    expect(script).toContain('--target slim')
    expect(script).toContain('image_slim')
  })
})
