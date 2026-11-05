// Single import point for modules from 0a/0b (ToolSource, AuthContext).
export type { ToolDef, ToolSource } from '../mcp/upstream-port'
export type { AuthContext } from '../auth/auth-context'

/** Thrown by the gateway when a tool no longer exists or is filtered out. */
export class ToolNotFoundError extends Error {
  constructor(public toolName: string) { super('Tool not found'); this.name = 'ToolNotFoundError' }
}
