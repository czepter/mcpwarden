/**
 * Client-IP fuer Rate-Limits (Spec P0-10, TRUST_PROXY). Ohne vertrauenswuerdigen Proxy zaehlt nur die Socket-Adresse;
 * `X-Forwarded-For` ist dann frei erfindbar und wird nie gelesen. Mit `TRUST_PROXY=N` gilt der N-te Eintrag von rechts:
 * jeder vertraute Proxy haengt die Adresse seines Gegenuebers rechts an, alles links davon stammt vom Client.
 * Faellt die Kette kuerzer aus als erwartet oder ist der Eintrag keine IP, gilt die Socket-Adresse (nie ein Client-Wert).
 */
import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import { getConfig } from './config'

/** Interner Header: wird fuer jede Anfrage neu gesetzt (ein vom Client mitgeschickter Wert wird ueberschrieben/entfernt). */
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

/** Web-Request fuer Better Auth mit der aufgeloesten Client-IP im internen Header (siehe `advanced.ipAddress`). */
export function toAuthRequest(event: H3Event): Request {
  const req = toWebRequest(event)
  req.headers.delete(CLIENT_IP_HEADER)
  const ip = clientIp(event)
  if (ip) req.headers.set(CLIENT_IP_HEADER, ip)
  return req
}
