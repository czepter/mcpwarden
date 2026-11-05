/**
 * Client IP for rate limits (spec P0-10, TRUST_PROXY). Without a trusted proxy only the socket address counts;
 * `X-Forwarded-For` is then freely forgeable and is never read. With `TRUST_PROXY=N` the N-th entry from the right applies:
 * each trusted proxy appends the address of its peer on the right, everything to the left of it comes from the client.
 * If the chain is shorter than expected or the entry is not an IP, the socket address applies (never a client value).
 */
import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import { getConfig } from './config'

/** Internal header: set anew for every request (a value sent by the client is overwritten/removed). */
export const CLIENT_IP_HEADER = 'x-mcpw-client-ip'

export function resolveClientIp(o: { forwardedFor?: string | null, socketIp?: string | null, trustProxy: number }): string | undefined {
  const socket = o.socketIp && isIP(o.socketIp) ? o.socketIp : undefined
  if (o.trustProxy > 0 && o.forwardedFor) {
    const parts = o.forwardedFor.split(',').map(p => p.trim()).filter(Boolean)
    const hop = parts.length >= o.trustProxy ? parts[parts.length - o.trustProxy] : undefined
    if (hop && isIP(hop)) return hop
  }
  return socket
}

export function clientIp(event: H3Event): string | undefined {
  const xff = event.node.req.headers['x-forwarded-for']
  return resolveClientIp({
    forwardedFor: Array.isArray(xff) ? xff.join(',') : xff,
    socketIp: event.node.req.socket.remoteAddress,
    trustProxy: getConfig().trustProxy,
  })
}

/** Web request for Better Auth with the resolved client IP in the internal header (see `advanced.ipAddress`). */
export function toAuthRequest(event: H3Event): Request {
  const req = toWebRequest(event)
  req.headers.delete(CLIENT_IP_HEADER)
  const ip = clientIp(event)
  if (ip) req.headers.set(CLIENT_IP_HEADER, ip)
  return req
}
