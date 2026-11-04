import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AllowList, assertUrlAllowed, isBlockedAddress, precheckUrl, SsrfBlockedError } from '../../server/gateway/net/ssrf'
import { createSafeFetch, UpstreamRedirectError } from '../../server/gateway/net/safe-fetch'

const BLOCKED_LITERALS = [
  'http://127.0.0.1/', 'http://[::1]/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/',
  'http://169.254.169.254/', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://192.0.2.1/', 'http://198.51.100.1/',
  'http://203.0.113.1/', 'http://[2001:db8::1]/', 'http://[2002:7f00:1::]/', 'http://[fd00:ec2::254]/',
  'http://[::ffff:127.0.0.1]/', 'http://[::ffff:a9fe:a9fe]/', 'http://[64:ff9b::7f00:1]/',
  'http://2130706433/', 'http://0x7f.1/', 'http://017700000001/', 'http://0177.0.0.1/', 'http://127.1/',
  'http://[::]/', 'http://[fe80::1]/', 'http://[ff02::1]/', 'http://224.0.0.1/', 'http://240.0.0.1/', 'http://198.18.0.1/',
  'http://[::ffff:10.0.0.1]/', 'http://[::7f00:1]/',
]
const PUBLIC_LITERALS = ['http://93.184.216.34/', 'http://[2606:4700::1111]/', 'https://8.8.8.8/', 'http://[2002:5db8:d822::]/']

describe('ssrf literals', () => {
  it.each(BLOCKED_LITERALS)('blocks %s', u => {
    expect(() => assertUrlAllowed(u)).toThrow(SsrfBlockedError)
  })
  it.each(PUBLIC_LITERALS)('allows %s', u => {
    expect(() => assertUrlAllowed(u)).not.toThrow()
  })
  it('rejects userinfo and non-http schemes', () => {
    expect(() => assertUrlAllowed('http://user:pw@93.184.216.34/')).toThrow(SsrfBlockedError)
    expect(() => assertUrlAllowed('file:///etc/passwd')).toThrow(SsrfBlockedError)
    expect(() => assertUrlAllowed('ftp://93.184.216.34/')).toThrow(SsrfBlockedError)
  })
  it('error message never contains the address', () => {
    try { assertUrlAllowed('http://169.254.169.254/') } catch (e) {
      expect((e as Error).message).not.toMatch(/169/)
      expect((e as Error).message).toMatch(/SSRF/)
    }
  })
  it('isBlockedAddress: unparsable is blocked', () => {
    expect(isBlockedAddress('nonsense')).toBe(true)
  })
  it('allow list: CIDR and exact address', () => {
    const a = new AllowList(['10.1.0.0/16', '192.168.5.5'])
    expect(() => assertUrlAllowed('http://10.1.2.3/', a)).not.toThrow()
    expect(() => assertUrlAllowed('http://10.2.0.1/', a)).toThrow()
    expect(() => assertUrlAllowed('http://192.168.5.5/', a)).not.toThrow()
    expect(() => assertUrlAllowed('http://192.168.5.6/', a)).toThrow()
  })
})

describe('ssrf with real local server (no connection reaches the target)', () => {
  let server: Server
  let port: number
  let connections = 0
  let requests: string[] = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push(req.url ?? '')
      if (req.url === '/redir') { res.writeHead(302, { location: 'http://169.254.169.254/' }).end(); return }
      if (req.url === '/ra') { res.writeHead(429, { 'retry-after': '7' }).end(); return }
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
    })
    server.on('connection', () => { connections++ })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => server.close())
  const reset = () => { connections = 0; requests = [] }

  it('literal 127.0.0.1 blocked, zero connections', async () => {
    reset()
    const f = createSafeFetch()
    await expect(f(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    await expect(f(`http://2130706433:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    await expect(f(`http://[::ffff:127.0.0.1]:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(connections).toBe(0)
    await f.close()
  })
  it('hostname resolving to private IP blocked (also with several records)', async () => {
    reset()
    const f = createSafeFetch({ resolver: async h => (h === 'multi.test' ? ['93.184.216.34', '127.0.0.1'] : ['127.0.0.1']) })
    await expect(f(`http://evil.test:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    await expect(f(`http://multi.test:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(connections).toBe(0)
    await f.close()
  })
  it('DNS rebinding: public at precheck, private at connect -> blocked', async () => {
    reset()
    let n = 0
    const resolver = async () => (++n === 1 ? ['93.184.216.34'] : ['127.0.0.1'])
    const allow = new AllowList()
    await expect(precheckUrl(`http://rebind.test:${port}/`, allow, resolver)).resolves.toBeInstanceOf(URL)
    const f = createSafeFetch({ resolver })
    await expect(f(`http://rebind.test:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    expect(connections).toBe(0)
    await f.close()
  })
  it('allow list entry (CIDR) opens exactly that target', async () => {
    reset()
    const f = createSafeFetch({ getAllow: () => new AllowList(['127.0.0.0/8']), resolver: async () => ['127.0.0.1'] })
    const r = await f(`http://127.0.0.1:${port}/`)
    expect(await r.text()).toBe('ok')
    await f.close()
    const f2 = createSafeFetch({ getAllow: () => new AllowList(['10.0.0.0/8']), resolver: async () => ['127.0.0.1'] })
    await expect(f2(`http://x.test:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    await f2.close()
  })
  it('allow list entry (hostname) opens that name only, not others on the same IP', async () => {
    reset()
    const f = createSafeFetch({ getAllow: () => new AllowList(['internal.test']), resolver: async () => ['127.0.0.1'] })
    expect(await (await f(`http://internal.test:${port}/`)).text()).toBe('ok')
    await expect(f(`http://other.test:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    await expect(f(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(SsrfBlockedError)
    await f.close()
  })
  it('redirect to metadata IP / localhost is not followed', async () => {
    reset()
    const f = createSafeFetch({ getAllow: () => new AllowList(['127.0.0.0/8']) })
    await expect(f(`http://127.0.0.1:${port}/redir`)).rejects.toBeInstanceOf(UpstreamRedirectError)
    expect(requests).toEqual(['/redir'])
    await f.close()
  })
  it('captures Retry-After', async () => {
    let got = 0
    const f = createSafeFetch({ getAllow: () => new AllowList(['127.0.0.0/8']), onRetryAfter: (_h, s) => { got = s } })
    const r = await f(`http://127.0.0.1:${port}/ra`)
    expect(r.status).toBe(429)
    expect(got).toBe(7)
    await f.close()
  })
})
