/**
 * Import of existing client configs (`{ "mcpServers": { "<name>": { url | command, args, env, headers } } }`, the Claude Desktop / Cursor
 * format). Every entry goes through the normal create path (validation, SSRF check, limits, audit); secrets (Authorization/other headers,
 * env values) are stored encrypted and never echoed. stdio entries are created DISABLED: nothing runs until the user switches the
 * upstream on in the web UI (which re-checks the stdio permission).
 */
import type { UpstreamImportItem, UpstreamImportResult, UpstreamType } from '#shared/api-types'
import { apiError } from '../utils/api'
import * as svc from './service'
import { isValidSlug } from './upstream/slug'
import { assertUrlAllowed, SsrfBlockedError } from './net/ssrf'
import type { Runtime } from './runtime'

type Who = { id: string, role: 'admin' | 'user' }

export const IMPORT_MAX_BYTES = 256 * 1024
export const IMPORT_MAX_ENTRIES = 50
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

type Entry = {
  name: string
  type: UpstreamType
  url?: string
  transport?: 'auto' | 'streamable' | 'sse'
  command?: string
  args?: string[]
  env: Record<string, string>
  /** One header becomes the upstream's auth secret (bearer or custom header). */
  secret?: { kind: 'bearer' | 'header', headerName?: string, value: string }
  notes: string[]
}
type Parsed = { entry: Entry } | { name: string, reason: 'invalid' | 'unsupported', message: string }

/** `my Server_1` -> `my-server-1`; always matches the slug rule or falls back to `mcp`. */
export function slugFor(name: string): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '')
  return isValidSlug(s) ? s : 'mcp'
}
const withSuffix = (base: string, n: number) => `${base.slice(0, 32 - String(n).length - 1).replace(/-+$/g, '')}-${n}`

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function parseEntry(name: string, raw: unknown): Parsed {
  if (!isObj(raw)) return { name, reason: 'invalid', message: 'Eintrag ist kein Objekt' }
  const notes: string[] = []
  const url = typeof raw.url === 'string' ? raw.url : typeof raw.serverUrl === 'string' ? raw.serverUrl : typeof raw.httpUrl === 'string' ? raw.httpUrl : undefined
  const command = typeof raw.command === 'string' ? raw.command.trim() : undefined
  const t = typeof raw.type === 'string' ? raw.type.toLowerCase() : typeof raw.transport === 'string' ? raw.transport.toLowerCase() : undefined
  if (t && !['stdio', 'http', 'streamable-http', 'streamablehttp', 'streamable_http', 'sse'].includes(t)) return { name, reason: 'unsupported', message: `Typ „${t.slice(0, 30)}“ wird nicht unterstützt` }
  if (url && command) return { name, reason: 'invalid', message: 'Eintrag hat url und command' }
  if (!url && !command) return { name, reason: 'invalid', message: 'Eintrag braucht url oder command' }

  const env: Record<string, string> = {}
  if (raw.env !== undefined) {
    if (!isObj(raw.env)) return { name, reason: 'invalid', message: 'env ist kein Objekt' }
    for (const [k, v] of Object.entries(raw.env)) {
      if (FORBIDDEN_KEYS.has(k)) continue
      if (typeof v !== 'string') return { name, reason: 'invalid', message: `env.${k.slice(0, 40)} ist kein Text` }
      if (v !== '') env[k] = v
    }
  }
  if (command) {
    let args: string[] = []
    if (raw.args !== undefined) {
      if (!Array.isArray(raw.args) || raw.args.some(a => typeof a !== 'string')) return { name, reason: 'invalid', message: 'args muss eine Liste von Texten sein' }
      args = raw.args as string[]
    }
    return { entry: { name, type: 'stdio', command, args, env, notes } }
  }
  const entry: Entry = { name, type: 'http', url, transport: t === 'sse' ? 'sse' : t ? 'streamable' : 'auto', env: {}, notes }
  if (Object.keys(env).length) notes.push('env wird bei HTTP-Upstreams ignoriert')
  if (raw.headers !== undefined) {
    if (!isObj(raw.headers)) return { name, reason: 'invalid', message: 'headers ist kein Objekt' }
    const hs = Object.entries(raw.headers).filter(([k, v]) => !FORBIDDEN_KEYS.has(k) && typeof v === 'string' && v !== '') as Array<[string, string]>
    const auth = hs.find(([k]) => k.toLowerCase() === 'authorization')
    const bearer = auth && /^bearer\s+(\S.*)$/i.exec(auth[1])
    if (bearer) entry.secret = { kind: 'bearer', value: bearer[1]!.trim() }
    const rest = hs.filter(h => h !== auth || !bearer)
    if (!entry.secret && rest.length) { const [k, v] = rest.shift()!; entry.secret = { kind: 'header', headerName: k, value: v } }
    if (rest.length) notes.push(`${rest.length} weitere(r) Header nicht übernommen (ein Zugangs-Header je Upstream): ${rest.map(([k]) => k).slice(0, 5).join(', ')}`)
  }
  return { entry }
}

/** Parses and validates the text only (no database). Throws 422 for unusable input. */
export function parseMcpServers(json: unknown): Parsed[] {
  if (typeof json !== 'string' || !json.trim()) throw apiError(422, 'validation', 'json fehlt', 'json')
  if (Buffer.byteLength(json) > IMPORT_MAX_BYTES) throw apiError(422, 'validation', `Das JSON ist größer als ${IMPORT_MAX_BYTES / 1024} KB`, 'json')
  let doc: unknown
  try { doc = JSON.parse(json) } catch { throw apiError(422, 'invalid_json', 'Das ist kein gültiges JSON', 'json') }
  const servers = isObj(doc) ? (isObj(doc.mcpServers) ? doc.mcpServers : isObj(doc.servers) ? doc.servers : null) : null
  if (!servers) throw apiError(422, 'invalid_json', 'Erwartet wird ein Objekt mit „mcpServers“', 'json')
  const names = Object.keys(servers).filter(k => !FORBIDDEN_KEYS.has(k))
  if (!names.length) throw apiError(422, 'invalid_json', 'Unter „mcpServers“ steht kein Eintrag', 'json')
  if (names.length > IMPORT_MAX_ENTRIES) throw apiError(422, 'validation', `Höchstens ${IMPORT_MAX_ENTRIES} Einträge je Import`, 'json')
  return names.map(n => parseEntry(n.trim().slice(0, 80) || 'mcp', servers[n]))
}

const codeOf = (e: unknown) => (e as { data?: { code?: string, message?: string } })?.data
const msgOf = (e: unknown) => codeOf(e)?.message ?? (e as Error)?.message ?? 'Fehler'

export async function importUpstreams(rt: Runtime, who: Who, body: Record<string, unknown>): Promise<UpstreamImportResult> {
  const dryRun = body.dryRun === true
  const parsed = parseMcpServers(body.json)
  const [existing, limits, allow] = await Promise.all([rt.repo.listUpstreams(who.id), rt.repo.getLimits(who.id), rt.allow()])
  const stdioPolicy = await rt.stdioPolicyFor(who.role, limits.stdioAllowed)
  const taken = new Set(existing.map(u => u.slug))
  let room = limits.maxUpstreams - existing.length
  const items: UpstreamImportItem[] = []

  for (const p of parsed) {
    if (!('entry' in p)) { items.push({ name: p.name, status: 'skipped', reason: p.reason, message: p.message }); continue }
    const e = p.entry
    const base = slugFor(e.name)
    // Same server already present under that name: skip instead of creating a twin
    const twin = existing.find(u => u.slug === base && u.type === e.type && (e.type === 'http' ? u.url === e.url : u.command === e.command))
    if (twin) { items.push({ name: e.name, slug: base, type: e.type, status: 'skipped', reason: 'slug_taken', message: 'Ein Upstream mit diesem Kurznamen und Ziel gibt es schon' }); continue }
    if (e.type === 'stdio' && !stdioPolicy.allowed) { items.push({ name: e.name, slug: base, type: e.type, status: 'skipped', reason: 'stdio_not_allowed', message: 'stdio ist für dich nicht freigegeben' }); continue }
    if (room <= 0) { items.push({ name: e.name, slug: base, type: e.type, status: 'skipped', reason: 'limit_reached', message: 'Das Upstream-Limit ist erreicht' }); continue }
    if (e.url) {
      try { assertUrlAllowed(e.url, allow) } catch (err) {
        if (err instanceof SsrfBlockedError) { items.push({ name: e.name, slug: base, type: e.type, status: 'skipped', reason: 'invalid', message: 'Dieses Ziel ist nicht erlaubt (SSRF-Schutz)' }); continue }
        items.push({ name: e.name, slug: base, type: e.type, status: 'skipped', reason: 'invalid', message: 'url ist keine gültige Adresse' }); continue
      }
    }
    let slug = base
    for (let n = 2; taken.has(slug) && n < 1000; n++) slug = withSuffix(base, n)
    const notes = e.notes.length ? e.notes : undefined
    if (dryRun) {
      // Same validation as the real path, without writing
      try { validateOnly(e, slug) } catch (err) { items.push({ name: e.name, slug, type: e.type, status: 'skipped', reason: 'invalid', message: msgOf(err) }); continue }
      taken.add(slug); room--
      items.push({ name: e.name, slug, type: e.type, status: 'would_create', ...(notes ? { notes } : {}) })
      continue
    }
    try {
      const envKeys = Object.keys(e.env)
      const authType = e.type === 'stdio' ? (envKeys.length ? 'env' : 'none') : e.secret ? e.secret.kind : 'none'
      const created = await svc.createUpstream(rt, who, {
        name: e.name, slug, type: e.type, ...(e.url ? { url: e.url, transport: e.transport } : {}), ...(e.command ? { command: e.command, args: e.args } : {}),
        authType, ...(e.secret?.kind === 'header' ? { authHeaderName: e.secret.headerName } : {}),
      })
      taken.add(slug); room--
      let id = created.id
      try {
        if (e.type === 'stdio') {
          for (const [k, v] of Object.entries(e.env)) await svc.putSecret(rt, who, id, { kind: 'env', name: k, value: v })
          // Draft: stays off until the user enables it in the UI
          await svc.patchUpstream(rt, who, id, { enabled: false })
        } else if (e.secret) await svc.putSecret(rt, who, id, { kind: e.secret.kind, value: e.secret.value })
      } catch (err) {
        // No half-imported upstream: roll the creation back
        await svc.deleteUpstream(rt, who, id).catch(() => {})
        room++; taken.delete(slug)
        throw err
      }
      const after = await svc.getUpstream(rt, who, id)
      id = after.id
      items.push({ name: e.name, slug, type: e.type, status: 'created', id, setup: after.setup, ...(notes ? { notes } : {}) })
    } catch (err) {
      const code = codeOf(err)?.code
      items.push({
        name: e.name, slug, type: e.type, status: 'skipped',
        reason: code === 'limit_reached' ? 'limit_reached' : code === 'stdio_not_allowed' ? 'stdio_not_allowed' : code === 'slug_taken' ? 'slug_taken' : 'invalid',
        message: msgOf(err),
      })
      if (code === 'slug_taken') taken.add(slug)
    }
  }
  const created = items.filter(i => i.status !== 'skipped').length
  return { items, created, skipped: items.length - created }
}

/** Dry run: the checks createUpstream would reject on, minus database and limits. */
function validateOnly(e: Entry, slug: string) {
  if (!isValidSlug(slug)) throw new Error('slug ungültig')
  if (e.name.length > 80) throw new Error('name ist zu lang')
  if (e.url) {
    const u = new URL(e.url)
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('url muss http(s) ohne Zugangsdaten sein')
  }
  for (const k of Object.keys(e.env)) if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) throw new Error(`env-Name „${k.slice(0, 40)}“ ungültig`)
  if (e.secret?.kind === 'header' && !/^[A-Za-z0-9-]{1,64}$/.test(e.secret.headerName ?? '')) throw new Error('Headername ungültig')
}
