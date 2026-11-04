import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const walk = (d: string): string[] => readdirSync(d).flatMap(f => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))

it('HTTP client transports are only constructed in upstream/connect.ts (always with safe fetch)', () => {
  const offenders = walk('server').filter(f => f.endsWith('.ts') && !f.endsWith('upstream/connect.ts'))
    .filter(f => /new\s+(StreamableHTTPClientTransport|SSEClientTransport)\b/.test(readFileSync(f, 'utf8')))
  expect(offenders).toEqual([])
  const connect = readFileSync('server/gateway/upstream/connect.ts', 'utf8')
  expect(connect.match(/fetch: safeFetch/g)).not.toBeNull()
})
