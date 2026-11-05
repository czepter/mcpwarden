import { toTypedSchema } from '@vee-validate/zod'
import { describe, expect, it } from 'vitest'
import { formatCountdown, formatNumber, formatPercent, formatRelative } from '~/lib/format'
import { HEALTH_VALUES, OUTCOME_VALUES, SETUP_VALUES, healthLabel, outcomeLabel, scopeLabel, setupLabel, toolKind } from '~/lib/labels'
import { navFor } from '~/lib/nav'
import { SLUG_RE, signUpSchema, upstreamSchema } from '~/lib/zod-schemas'

describe('labels', () => {
  it('jeder Enumwert hat ein Label, unbekannte zeigen den Rohwert', () => {
    for (const v of HEALTH_VALUES) expect(healthLabel(v)).not.toBe(v)
    for (const v of OUTCOME_VALUES) expect(outcomeLabel(v)).not.toBe(v)
    for (const v of SETUP_VALUES) expect(setupLabel(v)).not.toBe(v)
    expect(healthLabel('neu')).toBe('neu')
    expect(scopeLabel('mcp:tools')).toBe('Tools auflisten und aufrufen')
    expect(toolKind({ destructiveHint: true })).toBe('löschend')
    expect(toolKind(undefined)).toBe('unbekannt')
  })
})

describe('format', () => {
  it('Zahlen mit schmalem Leerzeichen und Dezimalkomma', () => {
    expect(formatNumber(1840)).toBe('1 840')
    expect(formatNumber(9874)).toBe('9 874')
    expect(formatNumber(12.5, 1)).toBe('12,5')
    expect(formatPercent(0.987)).toBe('98,7 %')
    expect(formatCountdown(new Date(Date.now() + 42_000).toISOString())).toMatch(/^00:4[12]$/)
  })
  it('relative Zeit', () => {
    const now = Date.now()
    expect(formatRelative(new Date(now - 8000).toISOString(), now)).toContain('8')
    expect(formatRelative(null)).toBe('–')
  })
})

describe('nav', () => {
  it('Admin-Gruppe nur fuer Admins', () => {
    const labels = (r: 'admin' | 'user') => navFor(r).flatMap(g => g.items.map(i => i.label))
    expect(labels('admin')).toContain('Admin')
    expect(labels('user')).not.toContain('Admin')
  })
})

describe('zod-schemas', () => {
  it('Slug-Grenzfaelle', () => {
    expect(SLUG_RE.test('a'.repeat(32))).toBe(true)
    expect(SLUG_RE.test('a'.repeat(33))).toBe(false)
    expect(SLUG_RE.test('-abc')).toBe(false)
    expect(SLUG_RE.test('Abc')).toBe(false)
    expect(SLUG_RE.test('a__b')).toBe(false)
    expect(SLUG_RE.test('a-b')).toBe(true)
  })
  it('toTypedSchema mit zod 4 (Spike)', async () => {
    const r = await toTypedSchema(signUpSchema as never).parse({ name: 'x', email: 'a@b.de', password: 'kurz', confirm: 'anders' })
    expect(r.errors.map(e => e.path)).toEqual(expect.arrayContaining(['password', 'confirm']))
    const ok = await toTypedSchema(signUpSchema as never).parse({ name: 'x', email: 'a@b.de', password: 'langgenugpasswort', confirm: 'langgenugpasswort' })
    expect(ok.errors).toHaveLength(0)
  })
  it('Upstream-Schema: http braucht URL, stdio Befehl', () => {
    const base = { type: 'http', name: 'n', slug: 'n', url: '', transport: 'auto', authType: 'none', authHeaderName: '', secret: '', command: '', args: '', cwd: '', ratePerMin: 60, maxConcurrent: 5, connectS: 10, listS: 15, callS: 60 }
    expect(upstreamSchema.safeParse(base).success).toBe(false)
    expect(upstreamSchema.safeParse({ ...base, url: 'https://x.example/mcp' }).success).toBe(true)
    expect(upstreamSchema.safeParse({ ...base, url: 'https://u:p@x.example/' }).success).toBe(false)
    expect(upstreamSchema.safeParse({ ...base, type: 'stdio', command: 'uvx x', cwd: '../x' }).success).toBe(false)
  })
})
