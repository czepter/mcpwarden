// TEMPORÄRER STUB für server/mcp/upstream-port.ts (Phase 0b). Beim Merge löschen und
// server/gateway/ports.ts auf die echten Module umstellen.
import type { CallToolResult, Tool } from '@modelcontextprotocol/client'
import type { AuthContext } from '../auth/auth-context'

export type ToolDef = Tool
export interface ToolSource {
  listTools(ctx: AuthContext): Promise<ToolDef[]>
  callTool(ctx: AuthContext, name: string, args: Record<string, unknown>, opts: { signal: AbortSignal }): Promise<CallToolResult>
}
export class ToolNotFoundError extends Error {
  constructor(public toolName: string) { super('Tool not found'); this.name = 'ToolNotFoundError' }
}
