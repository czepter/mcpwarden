import type { CallToolResult } from '@modelcontextprotocol/client'

export type GatewayErrorCode = 'rate_limited' | 'breaker_open' | 'timeout' | 'upstream_error' | 'denied' | 'awaiting_auth' | 'draining' | 'connect_failed' | 'unauthorized' | 'ssrf_blocked' | 'redirect' | 'protocol' | 'cancelled' | 'limit' | 'invalid_arguments' | 'not_found' | 'internal'

/** Gateway-own errors arrive as a tool result with isError (4.4). */
export function errorResult(code: GatewayErrorCode, text: string, meta: Record<string, unknown> = {}): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }], _meta: { code, ...meta } }
}
