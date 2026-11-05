/** 401/403 responses for /mcp with WWW-Authenticate per RFC 6750 / RFC 9728 (plan 0b, task 2). */
import { SCOPE_MCP_TOOLS } from '../auth/scopes'

export type BearerError = 'invalid_token' | 'insufficient_scope'

function quote(v: string): string {
  return v.replace(/["\\]/g, '')
}

function json(status: number, headers: Record<string, string>, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  })
}

/** 401. Without `error` (no token sent) the challenge contains no error code (RFC 6750 3.1). */
export function unauthorized(resourceMetadataUrl: string, opts: { error?: 'invalid_token', description?: string } = {}): Response {
  const parts = [`Bearer resource_metadata="${quote(resourceMetadataUrl)}"`, `scope="${SCOPE_MCP_TOOLS}"`]
  if (opts.error) parts.push(`error="${opts.error}"`)
  if (opts.description) parts.push(`error_description="${quote(opts.description)}"`)
  return json(401, { 'www-authenticate': parts.join(', ') }, { error: opts.error ?? 'unauthorized', error_description: opts.description })
}

/** 403 on a missing scope. */
export function forbidden(resourceMetadataUrl: string, scope: string = SCOPE_MCP_TOOLS): Response {
  const challenge = `Bearer error="insufficient_scope", scope="${quote(scope)}", resource_metadata="${quote(resourceMetadataUrl)}"`
  return json(403, { 'www-authenticate': challenge }, { error: 'insufficient_scope', error_description: `scope ${scope} required` })
}

export function payloadTooLarge(): Response {
  return json(413, {}, { error: 'payload_too_large' })
}

export function methodNotAllowed(): Response {
  return json(405, { allow: 'POST' }, { error: 'method_not_allowed' })
}
