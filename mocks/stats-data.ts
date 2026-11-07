import type { HealthHour, StatsWindow } from '#shared/api-types'

/** Shared, deterministic helpers for the statistics mocks. */
export const WINDOW_FACTOR: Record<string, number> = { '5m': 0.01, '1h': 0.1, '24h': 1, '7d': 6.5 }
export const WINDOW_MIN: Record<string, number> = { '5m': 5, '1h': 60, '24h': 1440, '7d': 10080 }

export function series24(w: StatsWindow, base: number, f: (i: number, base: number) => number) {
  const span = WINDOW_MIN[w]! * 60_000
  return Array.from({ length: 24 }, (_, i) => ({ t: new Date(Date.now() - span + (i * span) / 24).toISOString(), calls: f(i, base) }))
}

const BY_STATUS: Record<string, string> = {
  healthy: 'gggggggggggggggggggggggg', degraded: 'ggggggggggggyggyyggyyyyy', open: 'ggggggggggggggggrrrrrrrr',
  auth_expired: 'ggggggggggggggggggnnnrrr', disabled: 'nnnnnnnnnnnnnnnnnnnnnnnn', unknown: 'nnnnnnnnnnnnnnnnnnnnnnnn',
}
const MAP: Record<string, HealthHour> = { g: 'ok', y: 'warn', r: 'err', n: 'none' }
export const hoursFor = (status: string): HealthHour[] => (BY_STATUS[status] ?? BY_STATUS.healthy!).split('').map(c => MAP[c]!)

/** 168 hours (7 days) for the heatmap: mostly ok, a bad hour on day 6 for degraded / open upstreams. */
export function heatmapFor(status: string): HealthHour[] {
  const out: HealthHour[] = Array.from({ length: 168 }, () => 'ok')
  if (status === 'disabled' || status === 'unknown') return out.map(() => 'none')
  if (status === 'degraded' || status === 'open') { out[110] = 'err'; out[109] = 'warn'; out[111] = 'warn'; for (let i = 150; i < 168; i++) out[i] = 'warn' }
  for (let i = 0; i < 6; i++) out[i] = 'none'
  return out
}
