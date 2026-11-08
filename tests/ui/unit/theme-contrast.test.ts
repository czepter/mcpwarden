import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// WCAG AA (4.5:1) for the text pairs of the design tokens, light and dark. Axe in the browser measures the same pairs;
// this check runs without a build and fails when a token in `.dark` drifts.
const css = readFileSync(resolve(process.cwd(), 'app/assets/css/tailwind.css'), 'utf8')
const block = (sel: RegExp) => css.match(sel)?.[1] ?? ''
const parse = (b: string) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => [m[1]!, m[2]!]))
const light = parse(block(/:root\s*{([^}]*)}/))
const dark = { ...light, ...parse(block(/\.dark\s*{([^}]*)}/)) }

const lum = (hex: string) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }

const PAIRS: Array<[string, string]> = [
  ['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'], ['primary-foreground', 'primary'],
  ['primary', 'card'], ['primary', 'background'], ['foreground', 'primary-tint'], ['primary', 'primary-tint'],
  ['muted-foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'muted'], ['secondary-foreground', 'card'], ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'], ['destructive', 'card'], ['destructive', 'background'],
  ['sidebar-foreground', 'sidebar'], ['sidebar-primary-foreground', 'sidebar-primary'], ['sidebar-accent-foreground', 'sidebar-accent'], ['muted-foreground', 'sidebar'],
  ['warn-fg', 'warn-bg'], ['ok-fg', 'ok-bg'], ['err-fg', 'err-bg'], ['avatar-fg', 'border'], ['muted-foreground', 'table-head'],
  ['st-healthy-fg', 'st-healthy-bg'], ['st-degraded-fg', 'st-degraded-bg'], ['st-open-fg', 'st-open-bg'], ['st-auth_expired-fg', 'st-auth_expired-bg'], ['st-disabled-fg', 'st-disabled-bg'], ['st-unknown-fg', 'st-unknown-bg'],
  ['st-healthy-fg', 'card'], ['st-degraded-fg', 'card'], ['st-open-fg', 'card'], ['st-disabled-fg', 'card'],
]

describe.each([['light', light], ['dark', dark]] as const)('contrast %s', (_n, t) => {
  it.each(PAIRS)('%s on %s >= 4.5:1', (fg, bg) => {
    expect(t[fg], fg).toBeTruthy()
    expect(t[bg], bg).toBeTruthy()
    expect(ratio(t[fg]!, t[bg]!), `${fg} ${t[fg]} on ${bg} ${t[bg]}`).toBeGreaterThanOrEqual(4.5)
  })
  it('white on the nav badge and destructive ground', () => {
    expect(ratio('#ffffff', t['nav-badge']!)).toBeGreaterThanOrEqual(4.5)
    expect(ratio('#ffffff', t['destructive-soft']!)).toBeGreaterThanOrEqual(4.5)
  })
})
it('every token of :root exists in .dark (no light value leaks into dark mode)', () => {
  const d = parse(block(/\.dark\s*{([^}]*)}/))
  const missing = Object.keys(light).filter(k => !(k in d) && !['radius'].includes(k))
  expect(missing).toEqual([])
})
