/**
 * Stage 1 of the meta-tool mode (spec P1 "intelligent routing"): keyword search over the user's catalog.
 * BM25 over name and description; the name counts triple, so `list_issues` beats a description that merely mentions issues.
 * Pure function, no I/O: the caller passes only tools that already passed the server-side filter (owner, enabled, token restriction).
 */
import type { ToolDef } from '../../mcp/upstream-port'

export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 25
const K1 = 1.2
const B = 0.75
const NAME_WEIGHT = 3
const MAX_QUERY = 512

/** Lower case, split on everything that is not a letter or digit (so `linear__list_issues` -> linear, list, issues) and on camelCase. */
export function tokenize(text: string): string[] {
  return text.slice(0, 4096).replace(/([a-z\d])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length > 1 || /\d/.test(t))
}

export type Ranked = { tool: ToolDef, score: number }

export function rankTools(query: string, tools: ToolDef[], limit = DEFAULT_LIMIT): Ranked[] {
  const q = [...new Set(tokenize(query.slice(0, MAX_QUERY)))]
  if (!q.length || !tools.length) return []
  const docs = tools.map((tool) => {
    const tf = new Map<string, number>()
    const add = (tokens: string[], w: number) => { for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + w) }
    add(tokenize(tool.name), NAME_WEIGHT)
    add(tokenize(tool.description ?? ''), 1)
    let len = 0
    for (const v of tf.values()) len += v
    return { tool, tf, len }
  })
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length || 1
  const df = new Map<string, number>()
  for (const t of q) df.set(t, docs.filter(d => d.tf.has(t) || [...d.tf.keys()].some(k => k.startsWith(t))).length)
  const out: Ranked[] = []
  for (const d of docs) {
    let score = 0
    for (const t of q) {
      // exact term, otherwise a prefix hit (`issue` finds `issues`) at half weight
      let f = d.tf.get(t) ?? 0
      if (!f) for (const [k, v] of d.tf) if (k.startsWith(t)) f += v / 2
      if (!f) continue
      const n = df.get(t) ?? 0
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (d.len / avg))))
    }
    if (score > 0) out.push({ tool: d.tool, score })
  }
  out.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
  return out.slice(0, Math.max(1, Math.min(limit, MAX_LIMIT)))
}
