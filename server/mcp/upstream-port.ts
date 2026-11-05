/**
 * Austauschpunkt fuer die Tool-Quelle (Plan 0b, Aufgabe 7): 0b liefert den Dummy-Upstream, Phase 1
 * implementiert dieses Interface mit der echten Registry. Der Handler kennt nur diese Schnittstelle.
 */
import type { CallToolResult, JSONObject } from '@modelcontextprotocol/server'
import type { AuthContext } from '../auth/auth-context'

export type ToolDef = {
  name: string // nach aussen `<upstream>__<tool>`
  description?: string
  inputSchema: { type: 'object', properties?: JSONObject, required?: string[] }
}

export interface ToolSource {
  listTools(ctx: AuthContext): Promise<ToolDef[]>
  callTool(ctx: AuthContext, name: string, args: Record<string, unknown>, opts: { signal: AbortSignal }): Promise<CallToolResult>
}
