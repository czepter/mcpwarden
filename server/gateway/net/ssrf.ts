import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'

/** Einheitliche, bewusst unspezifische Meldung: nennt nie die interne Adresse. */
export const SSRF_MESSAGE = 'Ziel nicht erlaubt (SSRF-Schutz)'

export class SsrfBlockedError extends Error {
  readonly code = 'ssrf_blocked'
  /** Nur fürs Log, nie für API-Antworten. */
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
  '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
]
const V6_BLOCKED = ['::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8', '2001:db8::/32']

function netList(v4: string[], v6: string[]) {
  const l = new BlockList()
  for (const c of v4) l.addSubnet(c.split('/')[0]!, Number(c.split('/')[1]), 'ipv4')
  for (const c of v6) l.addSubnet(c.split('/')[0]!, Number(c.split('/')[1]), 'ipv6')
  return l
}
const blocked = netList(V4_BLOCKED, V6_BLOCKED)

/** IPv6-Text -> 16 Bytes (kennt `::` und eingebettetes Dotted-v4). */
export function ipv6ToBytes(input: string): Uint8Array | null {
  let s = input.toLowerCase()
  if (s.includes('%')) return null // Zonen nie erlauben
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

const v4From = (b: Uint8Array, o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`

/** Liefert alle Adressen, die geprüft werden müssen (die Adresse selbst plus eingebettete v4). */
function expand(ip: string): string[] | null {
  if (isIPv4(ip)) return [ip]
  if (!isIPv6(ip)) return null
  const b = ipv6ToBytes(ip)
  if (!b) return null
  const out = [ip]
  const zeros = (from: number, to: number) => b.slice(from, to).every(x => x === 0)
  if (zeros(0, 10) && b[10] === 255 && b[11] === 255) out.push(v4From(b, 12)) // ::ffff:0:0/96
  else if (zeros(0, 12) && !zeros(12, 16)) out.push(v4From(b, 12)) // veraltetes IPv4-kompatibel ::a.b.c.d
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) out.push(v4From(b, 12)) // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) out.push(v4From(b, 2)) // 6to4 2002::/16
  return out
}

/** true = Adresse liegt in einem gesperrten Netz (ohne Ausnahmeliste). */
export function isBlockedAddress(ip: string): boolean {
  const all = expand(ip)
  if (!all) return true // nicht parsebar -> sperren
  return all.some(a => blocked.check(a, isIPv4(a) ? 'ipv4' : 'ipv6'))
}

/** Admin-Ausnahmeliste `ssrf.allow`: CIDR oder genauer Hostname. */
export class AllowList {
  private cidrs = new BlockList()
  private hosts = new Set<string>()
  constructor(entries: readonly string[] = []) {
    for (const raw of entries) {
      const e = raw.trim().toLowerCase()
      const slash = e.indexOf('/')
      if (slash > 0) {
        const addr = e.slice(0, slash)
        const bits = Number(e.slice(slash + 1))
        if (isIPv4(addr)) this.cidrs.addSubnet(addr, bits, 'ipv4')
        else if (isIPv6(addr)) this.cidrs.addSubnet(addr, bits, 'ipv6')
      } else if (isIP(e)) {
        this.cidrs.addAddress(e, isIPv4(e) ? 'ipv4' : 'ipv6')
      } else if (e) this.hosts.add(e)
    }
  }
  allowsHost(host: string) { return this.hosts.has(host.toLowerCase()) }
  allowsAddress(ip: string) {
    const all = expand(ip) ?? []
    return all.length > 0 && all.every(a => this.cidrs.check(a, isIPv4(a) ? 'ipv4' : 'ipv6'))
  }
}
export const emptyAllow = new AllowList()

/** Prüft die Adressen eines Hostnamens (oder ein Literal). Wirft SsrfBlockedError. */
export function assertAddressesAllowed(host: string, addresses: string[], allow: AllowList = emptyAllow) {
  if (addresses.length === 0) throw new SsrfBlockedError(`no address for ${host}`)
  const hostAllowed = allow.allowsHost(host)
  for (const a of addresses) {
    if (!isBlockedAddress(a)) continue
    if (hostAllowed || allow.allowsAddress(a)) continue
    throw new SsrfBlockedError(`${host} -> ${a}`)
  }
}

/** Literal-Prüfung vor dem Connect + Schema/Userinfo. Kein DNS. */
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
 * `lookup`-Funktion für undici `connect.lookup`: die geprüfte Antwort ist zugleich die, mit der
 * verbunden wird (keine zweite Auflösung -> kein Rebinding-Fenster).
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

/** Frühe Rückmeldung beim Speichern/Testen: nur Komfort, nie Schutz. */
export async function precheckUrl(input: string, allow: AllowList, resolver: Resolver = systemResolver) {
  const url = assertUrlAllowed(input, allow)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!isIP(host)) assertAddressesAllowed(host, await resolver(host), allow)
  return url
}
