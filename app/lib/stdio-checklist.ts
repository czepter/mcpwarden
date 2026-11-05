import type { StdioReason } from '#shared/api-types'
import { stdioReasonLabel } from './labels'

export type ChecklistState = 'ok' | 'blocked' | 'open'
export type ChecklistRow = { key: 'runtime' | 'instance' | 'account' | 'command', label: string, state: ChecklistState, detail?: string }

const RUNTIME_REASONS: string[] = ['supervisor_unreachable', 'no_capabilities']
export const checklistStateText: Record<ChecklistState, string> = { ok: 'Erfüllt', blocked: 'Blockiert', open: 'Offen' }

/**
 * Prerequisites for approving a stdio upstream, derived from `/api/me/capabilities`.
 * The server reports exactly one reason, the first match of its policy wins (image, instance, account, supervisor).
 * Rows before the blocking row are `ok`, rows behind it are `open` (not evaluated yet).
 * The last row is the user's own check of the command: it is never `ok` here, the approval itself confirms it.
 */
export function stdioChecklist(caps: { stdio: { allowed: boolean, reason?: StdioReason } }): ChecklistRow[] {
  const reason: string | undefined = caps.stdio.allowed ? undefined : (caps.stdio.reason ?? 'unknown')
  type Def = { key: ChecklistRow['key'], label: string, blockedBy: (r: string) => boolean }
  const order: Def[] = []
  if (reason === 'image_slim') order.push({ key: 'runtime', label: 'stdio-Laufzeit ist vorhanden', blockedBy: r => r === 'image_slim' })
  order.push({ key: 'instance', label: 'stdio ist auf dieser Instanz aktiviert', blockedBy: r => r === 'instance_disabled' })
  order.push({ key: 'account', label: 'Dein Konto ist für stdio freigegeben', blockedBy: r => r === 'not_granted' })
  if (reason && (RUNTIME_REASONS.includes(reason) || reason === 'unknown')) {
    order.push({ key: 'runtime', label: 'Prozess-Isolation ist verfügbar', blockedBy: r => RUNTIME_REASONS.includes(r) || r === 'unknown' })
  }
  const blockedAt = reason ? order.findIndex(o => o.blockedBy(reason)) : -1
  const rows: ChecklistRow[] = order.map((o, i) => {
    const state: ChecklistState = blockedAt < 0 || i < blockedAt ? 'ok' : i === blockedAt ? 'blocked' : 'open'
    const detail = state === 'blocked' ? (reason === 'unknown' ? 'stdio ist derzeit nicht verfügbar.' : stdioReasonLabel(reason!)) : undefined
    return { key: o.key, label: o.label, state, detail }
  })
  rows.push({ key: 'command', label: 'Befehl und Umgebung geprüft', state: 'open', detail: 'Das bestätigst du mit „Freigeben“. Prüfe die Angaben unten genau.' })
  return rows
}
