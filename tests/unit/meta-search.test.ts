import { describe, expect, it } from 'vitest'
import { rankTools, tokenize } from '../../server/gateway/proxy/search'
import type { ToolDef } from '../../server/mcp/upstream-port'

const t = (name: string, description = ''): ToolDef => ({ name, description, inputSchema: { type: 'object' } })
const CATALOG = [
  t('linear__list_issues', 'List issues with a filter'),
  t('linear__create_issue', 'Create a new issue in a team'),
  t('github__search_code', 'Search code across repositories'),
  t('github__list_pull_requests', 'Open pull requests of a repository'),
  t('sentry__list_issues', 'Errors grouped as issues'),
  t('filesystem__read_file', 'Read a file from the allowed directory'),
]

describe('tokenize', () => {
  it('splits on separators, double underscores and camelCase, lower cases', () => {
    expect(tokenize('linear__list_issues')).toEqual(['linear', 'list', 'issues'])
    expect(tokenize('getUserName, v2!')).toEqual(['get', 'user', 'name', 'v2'])
  })
  it('drops one-letter noise but keeps digits', () => {
    expect(tokenize('a b 7')).toEqual(['7'])
  })
})

describe('rankTools', () => {
  it('ranks the name match first and is case-insensitive', () => {
    const r = rankTools('Search CODE', CATALOG)
    expect(r[0]!.tool.name).toBe('github__search_code')
  })
  it('finds by description words and by prefix (issue -> issues)', () => {
    const names = rankTools('issue', CATALOG).map(x => x.tool.name)
    expect(names).toEqual(expect.arrayContaining(['linear__list_issues', 'linear__create_issue', 'sentry__list_issues']))
    expect(names).not.toContain('filesystem__read_file')
  })
  it('a name hit beats a description-only hit', () => {
    const r = rankTools('pull requests', [t('misc__other', 'mentions pull requests once'), t('github__pull_requests', 'x')])
    expect(r[0]!.tool.name).toBe('github__pull_requests')
  })
  it('returns nothing for empty, noise-only or unmatched queries', () => {
    expect(rankTools('', CATALOG)).toEqual([])
    expect(rankTools('!!! ?', CATALOG)).toEqual([])
    expect(rankTools('kubernetes', CATALOG)).toEqual([])
    expect(rankTools('issue', [])).toEqual([])
  })
  it('caps the result (limit, absolute maximum 25) and is deterministic on ties', () => {
    const many = Array.from({ length: 40 }, (_, i) => t(`up__tool_${String(i).padStart(2, '0')}`, 'shared words here'))
    expect(rankTools('shared', many, 3)).toHaveLength(3)
    expect(rankTools('shared', many, 1000)).toHaveLength(25)
    expect(rankTools('shared', many, 3).map(x => x.tool.name)).toEqual(['up__tool_00', 'up__tool_01', 'up__tool_02'])
  })
  it('survives very long queries', () => {
    expect(rankTools('issue '.repeat(5000), CATALOG).length).toBeGreaterThan(0)
  })
})
