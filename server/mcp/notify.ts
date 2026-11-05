/**
 * Bridge between the revocation paths (admin/self-service routes) and the /mcp gateway (plan 0b, task 8).
 * The gateway registers itself at the start of routes/mcp.ts; without a gateway (e.g. tests without /mcp traffic)
 * the calls have no effect. Phase 1 calls `notifyToolsChanged` on toggle and `closeUserStreams` from
 * `user-lifecycle.ts` on ban/delete.
 */
export interface StreamControl {
  notifyToolsChanged(userId: string): void
  closeUserStreams(userId: string): Promise<void>
}

const g = globalThis as typeof globalThis & { __mcpwStreams?: StreamControl }

export function bindStreamControl(c: StreamControl | undefined): void {
  g.__mcpwStreams = c
}

/** Reports `tools/list_changed` to exactly this user's open list streams. */
export function notifyToolsChanged(userId: string): void {
  g.__mcpwStreams?.notifyToolsChanged(userId)
}

/** Closes all open streams/requests of this user (revocation, ban). */
export async function closeUserStreams(userId: string): Promise<void> {
  await g.__mcpwStreams?.closeUserStreams(userId)
}
