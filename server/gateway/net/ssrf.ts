import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'

/** Uniform, deliberately unspecific message: never names the internal address. */
export const SSRF_MESSAGE = 'Ziel nicht erlaubt (SSRF-Schutz)'

export class SsrfBlockedError extends Error {
  readonly code = 'ssrf_blocked'
  /** For the log only, never for API responses. */
  readonly detail: string
  constructor(detail: string) {
    super(SSRF_MESSAGE)
    this.name = 'SsrfBlockedError'
    this.detail = detail
  }
}

const V4_BLOCKED = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12',
  '192.0.0.0/24', '192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '192.168.0.0/16',
  '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4', '192.88.99.0/24', '168.63.129.16/32' /* Azure WireServer */,
]
const V6_BLOCKED = [
  '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'fec0::/10' /* veraltet: site-local */, 'ff00::/8', '2001:db8::/32',
  '2001::/32' /* Teredo */, '64:ff9b:1::/48' /* NAT64 lokal */, '::ffff:0:0:0/96' /* SIIT IPv4-translated */,
]

/** Cloud metadata services: never via hostname exceptions, only via an explicitly named single address. */
const METADATA = ['169.254.169.254', '169.254.170.2', '100.100.100.200', '192.0.0.192', '168.63.129.16', 'fd00:ec2::254']
/** Link-local: never via hostname exceptions, only via CIDR/IP. */
const LINK_LOCAL = netList(['169.254.0.0/16'], ['fe80::/10'])

function netList(v4: string[], v6: string[]) {
  const l = new BlockList()
  for (const c of v4) l.addSubnet(c.split('/')[0]!, Number(c.split('/')[1]), 'ipv4')
  for (const c of v6) l.addSubnet(c.split('/')[0]!, Number(c.split('/')[1]), 'ipv6')
  return l
}
const blocked = netList(V4_BLOCKED, V6_BLOCKED)

/** IPv6 text -> 16 bytes (understands `::` and embedded dotted v4). */
export function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input.toLowerCase()
  if (s.includes('%')) return null // never allow zones
  let tail: number[] = []
  const m = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (m) {
    if (!isIPv4(m[1]!)) return null
    const o = m[1]!.split('.').map(Number)
    tail = [(o[0]! << 8) | o[1]!, (o[2]! << 8) | o[3]!]
    s = s.slice(0, -m[1]!.length) + '0:0'
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parse = (p: string) => (p === '' ? [] : p.split(':').map(g => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)))
  const head = parse(halves[0]!)
  const rest = halves.length === 2 ? parse(halves[1]!) : []
  let groups: number[]
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length
    if (fill < 1) return null
    groups = [...head, ...Array(fill).fill(0), ...rest]
  } else groups = head
  if (groups.length !== 8 || groups.some(Number.isNaN)) return null
  if (tail.length) { groups[6] = tail[0]!; groups[7] = tail[1]! }
  const out = new Uint8Array(16)
  groups.forEach((g, i) => { out[i * 2] = g >> 8; out[i * 2 + 1] = g & 255 })
  return out
}

const sameV6 = (a: string, b: string) => {
  const x = ipv6ToBytes(a), y = ipv6ToBytes(b)
  return !!x && !!y && x.every((v, i) => v === y[i])
}
const v4From = (b: Uint8Array, o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`

/** Returns all addresses that must be checked (the address itself plus embedded v4). */
function expand(ip: string): string[] | null {
  if (isIPv4(ip)) return [ip]
  if (!isIPv6(ip)) return null
  const b = ipv6ToBytes(ip)
  if (!b) return null
  const out = [ip]
  const zeros = (from: number, to: number) => b.slice(from, to).every(x => x === 0)
  if (zeros(0, 10) && b[10] === 255 && b[11] === 255) out.push(v4From(b, 12)) // ::ffff:0:0/96
  else if (zeros(0, 12) && !zeros(12, 16)) out.push(v4From(b, 12)) // deprecated IPv4-compatible ::a.b.c.d
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) out.push(v4From(b, 12)) // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) out.push(v4From(b, 2)) // 6to4 2002::/16
  return out
}

/** true = address lies in a blocked network (without the exception list). */
export function isBlockedAddress(ip: string): boolean {
  const all = expand(ip)
  if (!all) return true // not parseable -> block
  return all.some(a => blocked.check(a, isIPv4(a) ? 'ipv4' : 'ipv6'))
}

/** Admin exception list `ssrf.allow`: CIDR or exact hostname. */
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)*$/

/** Validates an entry of the exception list; returns the error text or null. For admin routes and configuration. */
export function validateAllowEntry(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  if (!e) return 'leerer Eintrag'
  const slash = e.indexOf('/')
  if (slash >= 0) {
    const addr = e.slice(0, slash)
    const bitsText = e.slice(slash + 1)
    if (!/^\d{1,3}$/.test(bitsText)) return 'ungültige Präfixlänge'
    const bits = Number(bitsText)
    if (isIPv4(addr)) return bits <= 32 ? null : 'Präfixlänge über 32'
    if (isIPv6(addr)) return bits <= 128 ? null : 'Präfixlänge über 128'
    return 'ungültige Adresse'
  }
  if (isIP(e)) return null
  return HOSTNAME_RE.test(e) && !/^[\d.]+$/.test(e) ? null : 'ungültiger Hostname'
}

export class AllowList {
  private cidrs = new BlockList()
  private exact = new BlockList() // single addresses only (literal or /32, /128): the only valid kind for metadata services
  private hosts = new Set<string>()
  /** Invalid entries throw immediately (configuration time); `AllowList.lenient` skips them for the runtime path. */
  constructor(entries: readonly string[] = []) {
    for (const raw of entries) {
      const bad = validateAllowEntry(raw)
      if (bad) throw new Error(`ssrf.allow: ${bad}: ${JSON.stringify(raw).slice(0, 80)}`)
      this.add(raw.trim().toLowerCase())
    }
  }
  /** Runtime: a broken stored entry must not cripple every fetch; it opens nothing. */
  static lenient(entries: readonly string[] = []): { list: AllowList, invalid: string[] } {
    const ok: string[] = []
    const invalid: string[] = []
    for (const e of entries) (validateAllowEntry(e) ? invalid : ok).push(e)
    return { list: new AllowList(ok), invalid }
  }
  private add(e: string) {
    const slash = e.indexOf('/')
    if (slash > 0) {
      const addr = e.slice(0, slash)
      const bits = Number(e.slice(slash + 1))
      const v = isIPv4(addr) ? 'ipv4' : 'ipv6'
      this.cidrs.addSubnet(addr, bits, v)
      if (bits === (v === 'ipv4' ? 32 : 128)) this.exact.addAddress(addr, v)
    } else if (isIP(e)) {
      const v = isIPv4(e) ? 'ipv4' : 'ipv6'
      this.cidrs.addAddress(e, v)
      this.exact.addAddress(e, v)
    } else this.hosts.add(e)
  }
  /** Explicitly allowed as a single address (no range). */
  allowsExactAddress(ip: string) {
    const all = expand(ip) ?? []
    return all.length > 0 && all.every(a => this.exact.check(a, isIPv4(a) ? 'ipv4' : 'ipv6'))
  }
  allowsHost(host: string) { return this.hosts.has(host.toLowerCase()) }
  allowsAddress(ip: string) {
    const all = expand(ip) ?? []
    return all.length > 0 && all.every(a => this.cidrs.check(a, isIPv4(a) ? 'ipv4' : 'ipv6'))
  }
}
export const emptyAllow = new AllowList()

/** Checks the addresses of a hostname (or a literal). Throws SsrfBlockedError. */
export function assertAddressesAllowed(host: string, addresses: string[], allow: AllowList = emptyAllow) {
  if (addresses.length === 0) throw new SsrfBlockedError(`no address for ${host}`)
  const hostAllowed = allow.allowsHost(host)
  for (const a of addresses) {
    if (!isBlockedAddress(a)) continue
    const all = expand(a) ?? [a]
    if (all.some(x => METADATA.includes(x.toLowerCase()) || (isIPv6(x) && sameV6(x, 'fd00:ec2::254')))) {
      // Metadata: only an explicitly named single address opens it, never a hostname or range
      if (allow.allowsExactAddress(a)) continue
    } else if (all.some(x => LINK_LOCAL.check(x, isIPv4(x) ? 'ipv4' : 'ipv6'))) {
      if (allow.allowsAddress(a)) continue // CIDR/IP, but never via hostname
    } else if (hostAllowed || allow.allowsAddress(a)) continue
    throw new SsrfBlockedError(`${host} -> ${a}`)
  }
}

/** Literal check before connecting + scheme/userinfo. No DNS. */
export function assertUrlAllowed(input: string | URL, allow: AllowList = emptyAllow): URL {
  let url: URL
  try { url = new URL(input) } catch { throw new SsrfBlockedError('invalid url') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfBlockedError(`scheme ${url.protocol}`)
  if (url.username || url.password) throw new SsrfBlockedError('userinfo in url')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) assertAddressesAllowed(host, [host], allow)
  return url
}

export type Resolver = (host: string) => Promise<string[]>
export const systemResolver: Resolver = async host => (await dnsLookup(host, { all: true, verbatim: true })).map(r => r.address)

/**
 * `lookup` function for undici `connect.lookup`: the checked answer is also the one used
 * to connect (no second resolution -> no rebinding window).
 */
export function createSafeLookup(getAllow: () => AllowList | Promise<AllowList>, resolver: Resolver = systemResolver) {
  return (hostname: string, options: { all?: boolean, family?: number }, cb: (err: Error | null, address?: unknown, family?: number) => void) => {
    void (async () => {
      const allow = await getAllow()
      const addrs = await resolver(hostname)
      assertAddressesAllowed(hostname, addrs, allow)
      const mapped = addrs.map(address => ({ address, family: isIPv4(address) ? 4 : 6 }))
      if (options.all) cb(null, mapped)
      else cb(null, mapped[0]!.address, mapped[0]!.family)
    })().catch(e => cb(e as Error))
  }
}

/** Early feedback when saving/testing: convenience only, never protection. */
export async function precheckUrl(input: string, allow: AllowList, resolver: Resolver = systemResolver) {
  const url = assertUrlAllowed(input, allow)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!isIP(host)) assertAddressesAllowed(host, await resolver(host), allow)
  return url
}
