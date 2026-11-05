// Einziger Import-Punkt für Module aus 0a/0b (ToolSource, AuthContext).
export type { ToolDef, ToolSource } from '../mcp/upstream-port'
export type { AuthContext } from '../auth/auth-context'

/** Wird vom Gateway geworfen, wenn ein Tool nicht (mehr) existiert oder gefiltert ist. */
export class ToolNotFoundError extends Error {
  constructor(public toolName: string) { super('Tool not found'); this.name = 'ToolNotFoundError' }
}
