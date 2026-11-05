/** Slug rules and namespacing `<slug>__<tool>` (P0-1, O2). No `_` in the slug so that `__` separates unambiguously. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
export const RESERVED_SLUGS = new Set(['mcpwarden'])
export const SEPARATOR = '__'

export const isValidSlug = (s: string) => SLUG_RE.test(s) && !RESERVED_SLUGS.has(s)

export function suggestSlug(name: string): string {
  const s = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '')
  return s || 'upstream'
}

export const namespaced = (slug: string, tool: string) => `${slug}${SEPARATOR}${tool}`

/** Splits at the first `__`. The slug must be valid, the tool may contain `__`. */
export function parseToolName(full: string): { slug: string, tool: string } | null {
  const i = full.indexOf(SEPARATOR)
  if (i <= 0) return null
  const slug = full.slice(0, i)
  const tool = full.slice(i + SEPARATOR.length)
  if (!tool || !SLUG_RE.test(slug)) return null
  return { slug, tool }
}
