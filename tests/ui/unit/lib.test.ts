import { toTypedSchema } from '@vee-validate/zod'
import { describe, expect, it } from 'vitest'
import { formatCountdown, formatNumber, formatPercent, formatRelative } from '~/lib/format'
import { HEALTH_VALUES, OUTCOME_VALUES, SETUP_VALUES, healthLabel, outcomeLabel, scopeLabel, setupLabel, toolKind } from '~/lib/labels'
import { FEATURES } from '~/lib/features'
import { navFor } from '~/lib/nav'
import { SLUG_RE, forgotSchema, resetSchema, signUpSchema, upstreamSchema } from '~/lib/zod-schemas'

describe('labels', () => {
  it('every enum value has a label, unknown ones show the raw value', () => {
    for (const v of HEALTH_VALUES) expect(healthLabel(v)).not.toBe(v)
    for (const v of OUTCOME_VALUES) expect(outcomeLabel(v)).not.toBe(v)
    for (const v of SETUP_VALUES) expect(setupLabel(v)).not.toBe(v)
    expect(healthLabel('new')).toBe('new')
    expect(scopeLabel('mcp:tools')).toBe('Tools auflisten und aufrufen')
    expect(toolKind({ destructiveHint: true })).toBe('löschend') // tests run with the German locale (tests/ui/setup.ts)
    expect(toolKind(undefined)).toBe('unbekannt')
  })
})

describe('format', () => {
  it('Numbers with narrow space and decimal comma', () => {
    expect(formatNumber(1840)).toBe('1 840')
    expect(formatNumber(9874)).toBe('9 874')
    expect(formatNumber(12.5, 1)).toBe('12,5')
    expect(formatPercent(0.987)).toBe('98,7 %')
    expect(formatCountdown(new Date(Date.now() + 42_000).toISOString())).toMatch(/^00:4[12]$/)
  })
  it('relative time', () => {
    const now = Date.now()
    expect(formatRelative(new Date(now - 8000).toISOString(), now)).toContain('8')
    expect(formatRelative(null)).toBe('–')
  })
})

describe('nav', () => {
  it('Admin group only for admins', () => {
    const labels = (r: 'admin' | 'user') => navFor(r).flatMap(g => g.items.map(i => i.label))
    expect(labels('admin')).toContain('Admin')
    expect(labels('user')).not.toContain('Admin')
  })
  it('Phase 2 pages (statistics) only in the mock build; without a backend route not in the navigation', () => {
    const labels = (p: boolean) => navFor('admin', p).flatMap(g => g.items.map(i => i.label))
    expect(labels(true)).toContain('Statistik')
    expect(labels(false)).not.toContain('Statistik')
    expect(labels(false)).toContain('Upstreams')
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
  it('toTypedSchema with zod 4 (spike)', async () => {
    const r = await toTypedSchema(signUpSchema as never).parse({ name: 'x', email: 'a@b.de', password: 'short', confirm: 'different' })
    expect(r.errors.map(e => e.path)).toEqual(expect.arrayContaining(['password', 'confirm']))
    const ok = await toTypedSchema(signUpSchema as never).parse({ name: 'x', email: 'a@b.de', password: 'longenoughpassword', confirm: 'longenoughpassword' })
    expect(ok.errors).toHaveLength(0)
  })
  it('Password reset schemas: email format, minimum length 12, confirmation', () => {
    expect(forgotSchema.safeParse({ email: 'a@b.de' }).success).toBe(true)
    expect(forgotSchema.safeParse({ email: 'kaputt' }).success).toBe(false)
    expect(resetSchema.safeParse({ password: '12345678901', confirm: '12345678901' }).success).toBe(false)
    expect(resetSchema.safeParse({ password: '123456789012', confirm: '123456789013' }).success).toBe(false)
    expect(resetSchema.safeParse({ password: '123456789012', confirm: '123456789012' }).success).toBe(true)
  })
  it('Upstream schema: http needs a URL, stdio a command', () => {
    const base = { type: 'http', name: 'n', slug: 'n', url: '', transport: 'auto', authType: 'none', authHeaderName: '', secret: '', command: '', args: '', cwd: '', ratePerMin: 60, maxConcurrent: 5, connectS: 10, listS: 15, callS: 60 }
    expect(upstreamSchema.safeParse(base).success).toBe(false)
    expect(upstreamSchema.safeParse({ ...base, url: 'https://x.example/mcp' }).success).toBe(true)
    expect(upstreamSchema.safeParse({ ...base, url: 'https://u:p@x.example/' }).success).toBe(false)
    expect(upstreamSchema.safeParse({ ...base, type: 'stdio', command: 'uvx x', cwd: '../x' }).success).toBe(false)
  })
})

describe('Phase switches', () => {
  it('Dark mode choice and admin scope in the consent are off until phase 2', () => {
    expect(FEATURES.colorSchemeChoice).toBe(false)
    expect(FEATURES.consentAdminScope).toBe(false)
  })
  it('Password: minimum length 12 as checked by the server', () => {
    const base = { name: 'x', email: 'a@b.de', confirm: '' }
    expect(signUpSchema.safeParse({ ...base, password: 'a'.repeat(11), confirm: 'a'.repeat(11) }).success).toBe(false)
    expect(signUpSchema.safeParse({ ...base, password: 'a'.repeat(12), confirm: 'a'.repeat(12) }).success).toBe(true)
  })
})
