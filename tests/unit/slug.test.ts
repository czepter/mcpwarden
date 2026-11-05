import { describe, expect, it } from 'vitest'
import { isValidSlug, namespaced, parseToolName, suggestSlug } from '../../server/gateway/upstream/slug'

describe('slug', () => {
  it('validates regex', () => {
    expect(isValidSlug('github')).toBe(true)
    expect(isValidSlug('a'.repeat(32))).toBe(true)
    expect(isValidSlug('a'.repeat(33))).toBe(false)
    for (const bad of ['', '-a', 'A', 'a_b', 'a__b', 'a b', 'ä', 'mcpwarden']) expect(isValidSlug(bad)).toBe(false)
  })
  it('suggests from name', () => {
    expect(suggestSlug('Mein  Server!')).toBe('mein-server')
    expect(suggestSlug('Über Café')).toBe('uber-cafe')
    expect(suggestSlug('!!!')).toBe('upstream')
    expect(isValidSlug(suggestSlug('x'.repeat(80)))).toBe(true)
  })
  it('namespaces and parses at first __', () => {
    expect(namespaced('gh', 'create_issue')).toBe('gh__create_issue')
    expect(parseToolName('gh__create_issue')).toEqual({ slug: 'gh', tool: 'create_issue' })
    expect(parseToolName('gh__a__b')).toEqual({ slug: 'gh', tool: 'a__b' })
    for (const bad of ['gh', '__x', 'gh__', 'GH__x', 'a_b__x']) expect(parseToolName(bad)).toBeNull()
  })
})
