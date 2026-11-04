/** Logik für /healthz und /readyz (die Routen-Dateien aus 0a rufen diese Funktionen). Upstream-Ausfall beeinflusst beide nie. */
export type Health = { status: 200 | 503, body: { status: 'ok' | 'unavailable' | 'draining' | 'not_ready' } }

export async function liveness(selectOne: () => Promise<unknown>): Promise<Health> {
  try { await selectOne(); return { status: 200, body: { status: 'ok' } } } catch { return { status: 503, body: { status: 'unavailable' } } }
}

export type ReadyInput = {
  migrated: boolean
  draining: boolean
  /** Nur im Ziel `full` mit STDIO_MODE != off prüfen; sonst `undefined`. */
  supervisorPing?: () => Promise<boolean>
}
export async function readiness(i: ReadyInput): Promise<Health> {
  if (i.draining) return { status: 503, body: { status: 'draining' } }
  if (!i.migrated) return { status: 503, body: { status: 'not_ready' } }
  if (i.supervisorPing) {
    const ok = await Promise.race([i.supervisorPing().catch(() => false), new Promise<boolean>(r => setTimeout(() => r(false), 2000))])
    if (!ok) return { status: 503, body: { status: 'not_ready' } }
  }
  return { status: 200, body: { status: 'ok' } }
}
