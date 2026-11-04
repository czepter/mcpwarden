const NNBSP = ' '

/** 1840 -> "1 840" (schmales Leerzeichen), Dezimalkomma. */
export function formatNumber(n: number, digits = 0): string {
  const [i, f] = Math.abs(n).toFixed(digits).split('.')
  const int = i!.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP)
  return (n < 0 ? '-' : '') + int + (f ? ',' + f : '')
}
export const formatMs = (ms: number | null | undefined) => ms == null ? '–' : `${formatNumber(ms)} ms`
export const formatPercent = (share: number, digits = 1) => `${formatNumber(share * 100, digits)} %`

const rtf = new Intl.RelativeTimeFormat('de', { numeric: 'always', style: 'narrow' })
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–'
  const diff = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(diff)
  if (abs < 5) return 'gerade eben'
  if (abs < 60) return rtf.format(diff, 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString() ? `heute ${formatTime(iso)}` : `${formatDate(iso)} ${formatTime(iso)}`
}
export function formatCountdown(iso: string | null, now = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
