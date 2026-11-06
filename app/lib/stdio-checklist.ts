import type { StdioReason } from '#shared/api-types'
import { t } from '~/lib/i18n'
import { stdioReasonLabel } from './labels'

export type ChecklistState = 'ok' | 'blocked' | 'open'
export type ChecklistRow = { key: 'runtime' | 'instance' | 'account' | 'command', label: string, state: ChecklistState, detail?: string }

const RUNTIME_REASONS: string[] = ['supervisor_unreachable', 'no_capabilities']
// Getters: the text is resolved at access time, so it follows the active locale.
export const checklistStateText: Record<ChecklistState, string> = {
  get ok() { return t('common.checklist.ok') },
  get blocked() { return t('common.checklist.blocked') },
  get open() { return t('common.checklist.open') },
}

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
  if (reason === 'image_slim') order.push({ key: 'runtime', label: t('common.checklist.runtime'), blockedBy: r => r === 'image_slim' })
  order.push({ key: 'instance', label: t('common.checklist.instance'), blockedBy: r => r === 'instance_disabled' })
  order.push({ key: 'account', label: t('common.checklist.account'), blockedBy: r => r === 'not_granted' })
  if (reason && (RUNTIME_REASONS.includes(reason) || reason === 'unknown')) {
    order.push({ key: 'runtime', label: t('common.checklist.isolation'), blockedBy: r => RUNTIME_REASONS.includes(r) || r === 'unknown' })
  }
  const blockedAt = reason ? order.findIndex(o => o.blockedBy(reason)) : -1
  const rows: ChecklistRow[] = order.map((o, i) => {
    const state: ChecklistState = blockedAt < 0 || i < blockedAt ? 'ok' : i === blockedAt ? 'blocked' : 'open'
    const detail = state === 'blocked' ? (reason === 'unknown' ? t('common.checklist.unavailable') : stdioReasonLabel(reason!)) : undefined
    return { key: o.key, label: o.label, state, detail }
  })
  rows.push({ key: 'command', label: t('common.checklist.command'), state: 'open', detail: t('common.checklist.commandDetail') })
  return rows
}
