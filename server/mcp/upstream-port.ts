/**
 * Swap point for the tool source (plan 0b, task 7): 0b supplies the dummy upstream, phase 1
 * implements this interface with the real registry. The handler knows only this interface.
 */
import type { CallToolResult, JSONObject } from '@modelcontextprotocol/server'
import type { AuthContext } from '../auth/auth-context'

export type ToolDef = {
  name: string // externally `<upstream>__<tool>`
  description?: string
  inputSchema: { type: 'object', properties?: JSONObject, required?: string[] }
}

export interface ToolSource {
  listTools(ctx: AuthContext): Promise<ToolDef[]>
  callTool(ctx: AuthContext, name: string, args: Record<string, unknown>, opts: { signal: AbortSignal }): Promise<CallToolResult>
}
