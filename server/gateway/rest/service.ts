/** REST upstream management: validation of the tool definitions, persistence, the sub-routes and the connection test. */
import type { RestTool, RestToolList, UpstreamDetail } from '#shared/api-types'
import { apiError } from '../../utils/api'
import { assertUrlAllowed, SsrfBlockedError } from '../net/ssrf'
import type { Runtime } from '../runtime'
import type { UpstreamRow } from '../upstream/types'
import { checkRestTools, RestToolError, type CheckedRestTool } from './template'

type Who = { id: string, role: 'admin' | 'user' }
const bad = (field: string, message: string) => apiError(422, 'validation', message, field)

/**
 * Validates `body.restTools` (undefined = not sent). Early SSRF feedback for absolute templates (convenience only;
 * the real check runs on every request in the safe fetch).
 */
export async function prepareRestTools(rt: Runtime, raw: unknown, hasBaseUrl: boolean): Promise<CheckedRestTool[] | undefined> {
  if (raw === undefined) return undefined
  let tools: CheckedRestTool[]
  try { tools = checkRestTools(raw, hasBaseUrl) } catch (e) {
    if (e instanceof RestToolError) throw bad(e.field ?? 'restTools', e.message)
    throw e
  }
  const allow = await rt.allow()
  for (const t of tools) {
    const m = /^(https?:\/\/[^/?#]*)/i.exec(t.urlTemplate)
    if (!m) continue
    try { assertUrlAllowed(m[1]!, allow) } catch (e) {
      if (e instanceof SsrfBlockedError) throw apiError(422, 'ssrf_blocked', `${t.name}: Dieses Ziel ist nicht erlaubt (SSRF-Schutz)`, 'urlTemplate')
      throw e
    }
  }
  return tools
}

/** REST upstreams know no command/transport/env fields and only none/bearer/header auth. */
export function guardRestFields(c: { command?: unknown, args?: unknown, cwd?: unknown, env?: unknown, transport?: unknown, authType?: string }) {
  if (c.command !== undefined || c.args !== undefined || c.cwd !== undefined || c.env !== undefined) throw bad('command', 'Feld gehört nicht zu REST')
  if (c.transport !== undefined) throw bad('transport', 'Feld gehört nicht zu REST')
  if (c.authType !== undefined && !['none', 'bearer', 'header'].includes(c.authType)) throw bad('authType', 'REST kennt nur Keine, Bearer und Header')
}

/** Registers the definitions as tools (counts, per-tool switches) right away instead of at the first client call. Best effort. */
export async function syncRestCatalog(rt: Runtime, who: Who, id: string): Promise<void> {
  try {
    const up = await rt.repo.getUpstream(who.id, id)
    if (up && up.type === 'rest' && up.setup === 'ready') { rt.gw.catalog.invalidate(who.id, id); await rt.gw.catalog.list(up, undefined, undefined, who.id) }
  } catch { /* the first call or test reports the problem */ }
}

export async function withRestTools(rt: Runtime, who: Who, d: UpstreamDetail): Promise<UpstreamDetail> {
  if (d.type !== 'rest') return d
  return { ...d, restTools: await rt.repo.listRestToolRecords(who.id, d.id) }
}

async function loadRest(rt: Runtime, who: Who, id: string) {
  const up = await rt.repo.getUpstream(who.id, id)
  if (!up) throw apiError(404, 'not_found', 'Upstream nicht gefunden')
  if (up.type !== 'rest') throw bad('type', 'Nur REST-Upstreams haben REST-Tools')
  return up
}

export async function listRestTools(rt: Runtime, who: Who, id: string): Promise<RestToolList> {
  await loadRest(rt, who, id)
  return { items: await rt.repo.listRestToolRecords(who.id, id) }
}

/** Replaces the whole set; bumps the version so pooled adapters and the catalog pick it up. */
export async function putRestTools(rt: Runtime, who: Who, id: string, body: Record<string, unknown>): Promise<RestToolList> {
  const up = await loadRest(rt, who, id)
  const tools = await prepareRestTools(rt, body.items, !!up.url)
  if (!tools) throw bad('items', 'items fehlt')
  await rt.repo.replaceRestTools(who.id, id, tools)
  await rt.repo.updateUpstream(who.id, id, {})
  await rt.gw.pool.invalidate(who.id, id)
  rt.gw.catalog.invalidate(who.id, id)
  await syncRestCatalog(rt, who, id)
  return { items: await rt.repo.listRestToolRecords(who.id, id) }
}

/**
 * Connection test for REST: the definitions are snapshotted by the catalog call before; here the target is probed.
 * A safe tool (GET, no required parameter) is called for real; without one the base URL is requested. Any answer below 500 counts as reachable.
 */
export async function probeRest(rt: Runtime, up: UpstreamRow, owner: string): Promise<void> {
  const entry = await rt.gw.pool.get(up, undefined, owner)
  const tools = (await rt.repo.listRestTools(owner, up.id)).filter(t => t.enabled)
  const safe = tools.find(t => t.method === 'GET' && !(t.inputSchema.required ?? []).length)
  const signal = AbortSignal.timeout(10_000)
  if (safe) { await entry.client.callTool({ name: safe.name, arguments: {} }, { signal }); return }
  if (up.url) {
    const res = await rt.gw.safeFetch(up.url, { method: 'GET', signal, redirect: 'error' })
    void res.body?.cancel().catch(() => {})
    if (res.status >= 500) throw Object.assign(new Error(`${res.status} vom Upstream`), { status: res.status })
  }
}

export type { RestTool }
