const NNBSP = ' '

/** 1840 -> "1 840" (schmales Leerzeichen), Dezimalkomma. */
export function formatNumber(n: number, digits = 0): string {
  const [i, f] = Math.abs(n).toFixed(digits).split('.')
  const int = i!.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP)
  return (n < 0 ? '-' : '') + int + (f ? ',' + f : '')
}
export const formatMs = (ms: number | null | undefined) => ms == null ? '–' : `${formatNumber(ms)} ms`
export const formatPercent = (share: number, digits = 1) => `${formatNumber(share * 100, digits)} %`

/** "vor 8 s", "vor 2 Min.", "vor 3 Std.", "vor 2 Tg." (Intl.RelativeTimeFormat liefert im Deutschen keine eindeutigen Kurzformen). */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–'
  const diff = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(diff)
  if (abs < 5) return 'gerade eben'
  const [n, unit] = abs < 60 ? [abs, 's'] : abs < 3600 ? [Math.round(abs / 60), 'Min.'] : abs < 86400 ? [Math.round(abs / 3600), 'Std.'] : [Math.round(abs / 86400), 'Tg.']
  return diff < 0 ? `vor ${n} ${unit}` : `in ${n} ${unit}`
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
