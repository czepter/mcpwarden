import { describe, expect, it } from 'vitest'
import { loadMessages, makeI18n } from '../helpers/i18n'
import { formatNumber, formatRelative } from '~/lib/format'
import { healthLabel, toolKind } from '~/lib/labels'
import { loginSchema } from '~/lib/zod-schemas'

const keys = (o: unknown, p = ''): string[] => o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => keys(v, p ? `${p}.${k}` : k)) : [p]

describe('locale files', () => {
  it('en and de have identical key sets', () => {
    expect(keys(loadMessages('de')).sort()).toEqual(keys(loadMessages('en')).sort())
  })
})

describe('English (default locale)', () => {
  it('labels, formats and validation messages follow the locale', () => {
    makeI18n('en')
    expect(healthLabel('healthy')).toBe('Healthy')
    expect(toolKind({ destructiveHint: true })).toBe('delete')
    expect(formatNumber(1840)).toBe('1,840')
    expect(formatNumber(12.5, 1)).toBe('12.5')
    expect(formatRelative(new Date(Date.now() - 120_000).toISOString())).toBe('2 min ago')
    const r = loginSchema.safeParse({ email: '', password: 'x' })
    expect(r.success ? '' : r.error.issues[0]!.message).toBe('Please enter an email address.')
    makeI18n('de')
  })
})
