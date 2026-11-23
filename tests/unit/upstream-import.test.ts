import { describe, expect, it } from 'vitest'
import { IMPORT_MAX_ENTRIES, parseMcpServers, slugFor } from '../../server/gateway/import'
import { checkTags } from '../../server/gateway/service'

const entry = (p: ReturnType<typeof parseMcpServers>[number]) => ('entry' in p ? p.entry : null)

describe('slugFor', () => {
  it('derives a valid short name', () => {
    expect(slugFor('My Server_1')).toBe('my-server-1')
    expect(slugFor('Äpfel & Birnen')).toBe('apfel-birnen')
    expect(slugFor('***')).toBe('mcp')
    expect(slugFor('x'.repeat(80))).toHaveLength(32)
  })
})

describe('parseMcpServers', () => {
  it('maps http, sse and stdio entries (Claude Desktop / Cursor format)', () => {
    const r = parseMcpServers(JSON.stringify({ mcpServers: {
      a: { url: 'https://a.example/mcp' },
      b: { url: 'https://b.example/sse', type: 'sse' },
      c: { command: 'npx', args: ['-y', 'pkg'], env: { KEY: 'v', EMPTY: '' } },
    } }))
    expect(entry(r[0]!)).toMatchObject({ type: 'http', url: 'https://a.example/mcp', transport: 'auto' })
    expect(entry(r[1]!)).toMatchObject({ transport: 'sse' })
    expect(entry(r[2]!)).toMatchObject({ type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { KEY: 'v' } })
  })

  it('turns a Bearer Authorization header into a bearer secret, another header into a header secret, extra headers are reported', () => {
    const r = parseMcpServers(JSON.stringify({ mcpServers: {
      a: { url: 'https://a.example', headers: { Authorization: 'Bearer tok123' } },
      b: { url: 'https://b.example', headers: { 'X-Api-Key': 'k', 'X-Other': 'o' } },
    } }))
    expect(entry(r[0]!)!.secret).toEqual({ kind: 'bearer', value: 'tok123' })
    const b = entry(r[1]!)!
    expect(b.secret).toEqual({ kind: 'header', headerName: 'X-Api-Key', value: 'k' })
    expect(b.notes.join()).toContain('X-Other')
    expect(JSON.stringify(b.notes)).not.toContain('"o"')
  })

  it('imports an mcp-remote wrapper as the HTTP upstream it points to', () => {
    const r = parseMcpServers(JSON.stringify({ mcpServers: {
      noco: { command: 'npx', args: ['-y', 'mcp-remote', 'http://noco.example/mcp/abc', '--transport', 'http-only', '--header', 'x-api-key: k1'] },
      envAuth: { command: 'npx', args: ['mcp-remote@latest', 'https://b.example/sse', '--transport', 'sse-only', '--header', 'Authorization:${AUTH}', '--debug'], env: { AUTH: 'Bearer t0k' } },
      win: { command: 'C:\\Program Files\\nodejs\\npx.cmd', args: ['-y', 'mcp-remote', 'https://c.example/mcp', '--static-oauth-client-info', '{}'] },
    } }))
    expect(entry(r[0]!)).toMatchObject({ type: 'http', url: 'http://noco.example/mcp/abc', transport: 'streamable', secret: { kind: 'header', headerName: 'x-api-key', value: 'k1' } })
    expect(entry(r[0]!)!.command).toBeUndefined()
    expect(entry(r[1]!)).toMatchObject({ type: 'http', transport: 'sse', secret: { kind: 'bearer', value: 't0k' }, env: {} })
    expect(entry(r[2]!)).toMatchObject({ type: 'http', url: 'https://c.example/mcp', transport: 'auto' })
    expect(entry(r[2]!)!.notes.join()).toContain('--static-oauth-client-info')
  })

  it('keeps other npx commands as stdio and rejects broken mcp-remote headers', () => {
    const r = parseMcpServers(JSON.stringify({ mcpServers: {
      pkg: { command: 'npx', args: ['-y', 'some-server', 'mcp-remote', 'https://x.example'] },
      noUrl: { command: 'npx', args: ['mcp-remote'] },
      badHeader: { command: 'npx', args: ['mcp-remote', 'https://x.example', '--header', 'novalue'] },
      missingVar: { command: 'npx', args: ['mcp-remote', 'https://x.example', '--header', 'Authorization:${NOPE}'] },
    } }))
    expect(entry(r[0]!)).toMatchObject({ type: 'stdio' })
    expect(entry(r[1]!)).toMatchObject({ type: 'stdio' })
    expect(r[2]).toMatchObject({ reason: 'invalid' })
    expect(r[3]).toMatchObject({ reason: 'invalid' })
  })

  it('reports unusable entries per entry instead of failing the whole import', () => {
    const r = parseMcpServers(JSON.stringify({ mcpServers: { none: {}, both: { url: 'https://x', command: 'y' }, weird: { url: 'https://x', type: 'carrier-pigeon' }, notObj: 3, envBad: { command: 'x', env: { A: 1 } } } }))
    expect(r.map(p => ('reason' in p ? p.reason : 'ok'))).toEqual(['invalid', 'invalid', 'unsupported', 'invalid', 'invalid'])
  })

  it('rejects broken input as a whole', () => {
    expect(() => parseMcpServers('')).toThrow()
    expect(() => parseMcpServers('{nope')).toThrow()
    expect(() => parseMcpServers('{"mcpServers":{}}')).toThrow()
    expect(() => parseMcpServers('[1]')).toThrow()
    expect(() => parseMcpServers(undefined)).toThrow()
    expect(() => parseMcpServers(JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: IMPORT_MAX_ENTRIES + 1 }, (_, i) => [`s${i}`, { url: 'https://x' }])) }))).toThrow()
    expect(() => parseMcpServers(`{"mcpServers":{"a":{"url":"https://x","pad":"${'x'.repeat(300 * 1024)}"}}}`)).toThrow()
  })

  it('does not let prototype keys through', () => {
    const r = parseMcpServers('{"mcpServers":{"__proto__":{"url":"https://x"},"ok":{"url":"https://y"}}}')
    expect(r).toHaveLength(1)
  })
})

describe('checkTags', () => {
  it('trims, lowercases and de-duplicates', () => {
    expect(checkTags(['  Prod ', 'prod', 'Team  A', ''])).toEqual(['prod', 'team a'])
  })
  it('rejects too many, too long, non-text and odd characters', () => {
    expect(() => checkTags(Array.from({ length: 11 }, (_, i) => `t${i}`))).toThrow()
    expect(() => checkTags(['x'.repeat(33)])).toThrow()
    expect(() => checkTags([1])).toThrow()
    expect(() => checkTags('prod')).toThrow()
    expect(() => checkTags(['<b>'])).toThrow()
  })
})
