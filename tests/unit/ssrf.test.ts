import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AllowList, assertAddressesAllowed, assertUrlAllowed, isBlockedAddress, precheckUrl, SsrfBlockedError, validateAllowEntry } from '../../server/gateway/net/ssrf'
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

describe('ssrf extended ranges and allow-list hardening (L2, L3)', () => {
  it.each([
    'http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/', // Teredo 2001::/32
    'http://[64:ff9b:1::1]/', // NAT64 local
    'http://[fec0::1]/', // site-local
    'http://192.88.99.1/', // 6to4-Relay-Anycast
    'http://[::ffff:0:10.0.0.1]/', // SIIT ::ffff:0:0:0/96
    'http://[::ffff:0:7f00:1]/',
  ])('blocks %s', (u) => {
    expect(() => assertUrlAllowed(u)).toThrow(SsrfBlockedError)
  })
  it('a hostname entry never opens metadata or link-local ranges, even for that exact host', () => {
    const a = new AllowList(['evil.example'])
    for (const ip of ['169.254.169.254', '100.100.100.200', 'fd00:ec2::254', '::ffff:169.254.169.254', '169.254.1.1', 'fe80::1', '192.0.0.192']) {
      expect(() => assertAddressesAllowed('evil.example', [ip], a), ip).toThrow(SsrfBlockedError)
    }
    expect(() => assertAddressesAllowed('evil.example', ['10.1.1.1'], a)).not.toThrow() // normal private address: hostname exception applies
  })
  it('a broad CIDR does not open metadata; only an explicit single address does', () => {
    for (const cidr of ['169.254.0.0/16', '100.64.0.0/10', '0.0.0.0/0', '::/0', 'fc00::/7']) {
      const a = new AllowList([cidr])
      expect(() => assertUrlAllowed('http://169.254.169.254/', a), cidr).toThrow(SsrfBlockedError)
      expect(() => assertUrlAllowed('http://100.100.100.200/', a), cidr).toThrow(SsrfBlockedError)
      expect(() => assertUrlAllowed('http://[fd00:ec2::254]/', a), cidr).toThrow(SsrfBlockedError)
    }
    expect(() => assertUrlAllowed('http://169.254.169.254/', new AllowList(['169.254.169.254']))).not.toThrow()
    expect(() => assertUrlAllowed('http://169.254.169.254/', new AllowList(['169.254.169.254/32']))).not.toThrow()
    expect(() => assertUrlAllowed('http://169.254.169.253/', new AllowList(['169.254.169.254']))).toThrow(SsrfBlockedError)
    // other link-local allowed via CIDR
    expect(() => assertUrlAllowed('http://169.254.5.5/', new AllowList(['169.254.5.0/24']))).not.toThrow()
  })
  it('malformed allow entries are rejected at config time; the lenient runtime parser skips them and opens nothing', () => {
    for (const bad of ['10.0.0.0/abc', '10.0.0.0/33', '::1/129', '10.0.0.0/', '/8', 'not a host', '', '1.2.3.4.5', 'a..b', '10.0.0.0/-1']) {
      expect(validateAllowEntry(bad), bad).not.toBeNull()
      expect(() => new AllowList([bad]), bad).toThrow(/ssrf\.allow/)
    }
    for (const good of ['10.0.0.0/8', '192.168.5.5', 'fd00::/8', 'internal.example', 'my_host.lan']) expect(validateAllowEntry(good), good).toBeNull()
    const { list, invalid } = AllowList.lenient(['10.0.0.0/abc', '10.1.0.0/16'])
    expect(invalid).toEqual(['10.0.0.0/abc'])
    expect(() => assertUrlAllowed('http://10.1.2.3/', list)).not.toThrow()
    expect(() => assertUrlAllowed('http://10.2.2.3/', list)).toThrow(SsrfBlockedError)
  })
})
