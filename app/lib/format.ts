import { currentLanguage, t } from '~/lib/i18n'
const NNBSP = ' '

/** 1840 -> "1 840" (narrow space, decimal comma) in German, "1,840" (decimal point) in English. */
export function formatNumber(n: number, digits = 0): string {
  const de = currentLanguage().startsWith('de')
  const [i, f] = Math.abs(n).toFixed(digits).split('.')
  const int = i!.replace(/\B(?=(\d{3})+(?!\d))/g, de ? NNBSP : ',')
  return (n < 0 ? '-' : '') + int + (f ? (de ? ',' : '.') + f : '')
}
export const formatMs = (ms: number | null | undefined) => ms == null ? '–' : `${formatNumber(ms)} ms`
export const formatPercent = (share: number, digits = 1) => `${formatNumber(share * 100, digits)}${currentLanguage().startsWith('de') ? ' ' : ''}%`

/** "8 s ago", "2 min ago" / "vor 8 s", "vor 2 Min." (Intl.RelativeTimeFormat yields no unambiguous short forms in German). */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–'
  const diff = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(diff)
  if (abs < 5) return t('common.time.now')
  const [n, unit] = abs < 60 ? [abs, 'sec'] : abs < 3600 ? [Math.round(abs / 60), 'min'] : abs < 86400 ? [Math.round(abs / 3600), 'hour'] : [Math.round(abs / 86400), 'day']
  return t(diff < 0 ? 'common.time.past' : 'common.time.future', { n, unit: t(`common.time.${unit}`) })
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString(currentLanguage(), { day: '2-digit', month: '2-digit', year: 'numeric' })
}
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(currentLanguage(), { hour: '2-digit', minute: '2-digit' })
}
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? `${t('common.time.today')} ${formatTime(iso)}` : `${formatDate(iso)} ${formatTime(iso)}`
}
export function formatCountdown(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
