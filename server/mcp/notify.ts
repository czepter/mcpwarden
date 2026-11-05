/**
 * Brücke zwischen den Widerrufspfaden (Admin-/Self-Service-Routen) und dem /mcp-Gateway (Plan 0b, Aufgabe 8).
 * Das Gateway registriert sich beim Start von routes/mcp.ts; ohne Gateway (z. B. Tests ohne /mcp-Traffic)
 * sind die Aufrufe wirkungslos. Phase 1 ruft `notifyToolsChanged` beim Toggle und `closeUserStreams` aus
 * `user-lifecycle.ts` beim Sperren/Loeschen.
 */
export interface StreamControl {
  notifyToolsChanged(userId: string): void
  closeUserStreams(userId: string): Promise<void>
}

const g = globalThis as typeof globalThis & { __mcpwStreams?: StreamControl }

export function bindStreamControl(c: StreamControl | undefined): void {
  g.__mcpwStreams = c
}

/** Meldet `tools/list_changed` an die offenen Listen-Streams genau dieses Nutzers. */
export function notifyToolsChanged(userId: string): void {
  g.__mcpwStreams?.notifyToolsChanged(userId)
}

/** Beendet alle offenen Streams/Anfragen dieses Nutzers (Widerruf, Sperre). */
export async function closeUserStreams(userId: string): Promise<void> {
  await g.__mcpwStreams?.closeUserStreams(userId)
}
