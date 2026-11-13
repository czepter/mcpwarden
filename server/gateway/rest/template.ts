/**
 * REST tools (spec P0-8): validation of tool definitions and safe rendering of a call.
 * Pure functions, no I/O. Rules that matter for security:
 *  - placeholders `{param}` are never allowed in the scheme/host/port of the URL template (no host injection);
 *  - values are percent-encoded; a path value of `.` or `..` is refused; the rendered URL must keep the template's origin;
 *  - header names are an allowlist-by-pattern minus hop-by-hop/auth headers, values cannot carry CR/LF/NUL.
 */
import type { RestMethod, RestToolInput } from '#shared/api-types'

export const REST_LIMITS = {
  tools: 50,
  nameRe: /^[a-zA-Z0-9_-]{1,64}$/,
  urlTemplate: 2048,
  description: 1000,
  bodyTemplate: 8 * 1024,
  schemaBytes: 32 * 1024,
  properties: 50,
  headers: 20,
  headerValue: 1024,
  stringArg: 8192,
  requestBodyBytes: 256 * 1024,
  responseBytes: 1024 * 1024,
  responseChars: 100_000,
} as const

export const REST_METHODS: readonly RestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const PROP_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'] as const
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/
/** Never settable by a tool: transport framing and the upstream's own credentials. */
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'authorization', 'cookie', 'set-cookie', 'expect'])
const PLACEHOLDER_RE = /\{([a-zA-Z_][a-zA-Z0-9_]{0,63})\}/g

export class RestToolError extends Error {
  constructor(message: string, readonly field?: string) { super(message) }
}

export const placeholders = (s: string): string[] => [...new Set([...s.matchAll(PLACEHOLDER_RE)].map(m => m[1]!))]

type Schema = { type: 'object', properties: Record<string, { type?: string, description?: string, enum?: unknown[], items?: unknown, maxLength?: number }>, required?: string[], [k: string]: unknown }

/** Splits `scheme://host[:port]` from the rest; null for a relative template (`/path?...`). */
function splitOrigin(tpl: string): { origin: string, rest: string } | null {
  const m = /^(https?:\/\/[^/?#]*)(.*)$/i.exec(tpl)
  return m ? { origin: m[1]!, rest: m[2]! } : null
}

export function normalizeSchema(input: unknown): Schema {
  if (input === undefined || input === null) return { type: 'object', properties: {} }
  if (typeof input !== 'object' || Array.isArray(input)) throw new RestToolError('inputSchema muss ein JSON-Schema-Objekt sein', 'inputSchema')
  const s = input as Record<string, unknown>
  if (JSON.stringify(s).length > REST_LIMITS.schemaBytes) throw new RestToolError('inputSchema ist zu groß', 'inputSchema')
  if (s.type !== undefined && s.type !== 'object') throw new RestToolError('inputSchema.type muss "object" sein', 'inputSchema')
  const props = (s.properties ?? {}) as Record<string, unknown>
  if (typeof props !== 'object' || Array.isArray(props)) throw new RestToolError('inputSchema.properties muss ein Objekt sein', 'inputSchema')
  const names = Object.keys(props)
  if (names.length > REST_LIMITS.properties) throw new RestToolError(`Höchstens ${REST_LIMITS.properties} Parameter je Tool`, 'inputSchema')
  for (const n of names) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(n)) throw new RestToolError(`Parametername „${n.slice(0, 40)}“ ungültig (Buchstaben, Ziffern, _)`, 'inputSchema')
    const p = props[n] as { type?: unknown } | null
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new RestToolError(`Parameter ${n} ungültig`, 'inputSchema')
    if (p.type !== undefined && !PROP_TYPES.includes(p.type as never)) throw new RestToolError(`Parameter ${n}: Typ muss ${PROP_TYPES.join(', ')} sein`, 'inputSchema')
  }
  const required = s.required ?? []
  if (!Array.isArray(required) || required.some(r => typeof r !== 'string' || !names.includes(r))) throw new RestToolError('inputSchema.required darf nur vorhandene Parameter nennen', 'inputSchema')
  return { ...s, type: 'object', properties: props as Schema['properties'], ...(required.length ? { required: required as string[] } : {}) }
}

export type CheckedRestTool = {
  name: string, description: string | null, method: RestMethod, urlTemplate: string,
  inputSchema: Schema, headers: Record<string, string>, bodyTemplate: string | null, enabled: boolean
}

/** Validates one definition; `hasBaseUrl` says whether the upstream has a base URL for relative templates. */
export function checkRestTool(raw: unknown, hasBaseUrl: boolean): CheckedRestTool {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RestToolError('Tool-Definition ungültig')
  const b = raw as Partial<RestToolInput> & Record<string, unknown>
  const name = b.name
  if (typeof name !== 'string' || !REST_LIMITS.nameRe.test(name)) throw new RestToolError('Toolname muss [a-zA-Z0-9_-]{1,64} entsprechen', 'name')
  const label = (m: string) => `${name}: ${m}`
  const method = (b.method ?? 'GET') as RestMethod
  if (!REST_METHODS.includes(method)) throw new RestToolError(label('method muss GET, POST, PUT, PATCH oder DELETE sein'), 'method')
  if (b.description != null && (typeof b.description !== 'string' || b.description.length > REST_LIMITS.description)) throw new RestToolError(label('description ist zu lang'), 'description')
  const urlTemplate = b.urlTemplate
  if (typeof urlTemplate !== 'string' || !urlTemplate || urlTemplate.length > REST_LIMITS.urlTemplate || /[\s\0]/.test(urlTemplate)) throw new RestToolError(label('urlTemplate fehlt oder ist ungültig'), 'urlTemplate')
  const split = splitOrigin(urlTemplate)
  if (split) {
    if (PLACEHOLDER_RE.test(split.origin)) { PLACEHOLDER_RE.lastIndex = 0; throw new RestToolError(label('Platzhalter sind in Schema und Host nicht erlaubt'), 'urlTemplate') }
    PLACEHOLDER_RE.lastIndex = 0
    if (/@/.test(split.origin)) throw new RestToolError(label('urlTemplate darf keine Zugangsdaten enthalten'), 'urlTemplate')
  } else {
    if (!urlTemplate.startsWith('/') || urlTemplate.startsWith('//')) throw new RestToolError(label('urlTemplate muss eine http(s)-Adresse oder ein Pfad mit / am Anfang sein'), 'urlTemplate')
    if (!hasBaseUrl) throw new RestToolError(label('Ein relativer Pfad braucht eine Basis-URL beim Upstream'), 'urlTemplate')
  }
  const inputSchema = normalizeSchema(b.inputSchema)
  const props = Object.keys(inputSchema.properties)
  const headers: Record<string, string> = {}
  if (b.headers !== undefined) {
    if (!b.headers || typeof b.headers !== 'object' || Array.isArray(b.headers)) throw new RestToolError(label('headers muss ein Objekt sein'), 'headers')
    const entries = Object.entries(b.headers as Record<string, unknown>)
    if (entries.length > REST_LIMITS.headers) throw new RestToolError(label(`Höchstens ${REST_LIMITS.headers} Header`), 'headers')
    for (const [k, v] of entries) {
      if (!HEADER_NAME_RE.test(k) || FORBIDDEN_HEADERS.has(k.toLowerCase()) || k.toLowerCase().startsWith('proxy-') || k.toLowerCase().startsWith('sec-')) throw new RestToolError(label(`Header „${k.slice(0, 40)}“ ist nicht erlaubt`), 'headers')
      if (typeof v !== 'string' || v.length > REST_LIMITS.headerValue || /[\r\n\0]/.test(v)) throw new RestToolError(label(`Header ${k}: Wert ungültig`), 'headers')
      headers[k] = v
    }
  }
  let bodyTemplate: string | null = null
  if (b.bodyTemplate != null) {
    if (typeof b.bodyTemplate !== 'string' || b.bodyTemplate.length > REST_LIMITS.bodyTemplate) throw new RestToolError(label('bodyTemplate ist zu lang'), 'bodyTemplate')
    if (method === 'GET' || method === 'DELETE') throw new RestToolError(label(`${method} kennt keinen Body`), 'bodyTemplate')
    try { JSON.parse(b.bodyTemplate) } catch { throw new RestToolError(label('bodyTemplate muss gültiges JSON sein'), 'bodyTemplate') }
    bodyTemplate = b.bodyTemplate
  }
  // Every placeholder must be a declared parameter; path placeholders must be required (there is no way to omit them).
  const used = new Set([...placeholders(urlTemplate), ...Object.values(headers).flatMap(placeholders), ...(bodyTemplate ? placeholders(bodyTemplate) : [])])
  for (const p of used) if (!props.includes(p)) throw new RestToolError(label(`Platzhalter {${p}} ist kein Parameter in inputSchema`), 'inputSchema')
  const pathPart = (split ? split.rest : urlTemplate).split(/[?#]/)[0]!
  for (const p of placeholders(pathPart)) if (!(inputSchema.required ?? []).includes(p)) throw new RestToolError(label(`Pfad-Parameter {${p}} muss required sein`), 'inputSchema')
  return { name, description: (b.description as string | null | undefined) ?? null, method, urlTemplate, inputSchema, headers, bodyTemplate, enabled: b.enabled !== false }
}

export function checkRestTools(raw: unknown, hasBaseUrl: boolean): CheckedRestTool[] {
  if (!Array.isArray(raw)) throw new RestToolError('restTools muss eine Liste sein', 'restTools')
  if (raw.length > REST_LIMITS.tools) throw new RestToolError(`Höchstens ${REST_LIMITS.tools} REST-Tools je Upstream`, 'restTools')
  const out = raw.map(r => checkRestTool(r, hasBaseUrl))
  const seen = new Set<string>()
  for (const t of out) { if (seen.has(t.name)) throw new RestToolError(`Toolname ${t.name} kommt doppelt vor`, 'restTools'); seen.add(t.name) }
  return out
}

// ---------- Argument check ----------

function typeOk(type: string | undefined, v: unknown): boolean {
  switch (type) {
    case undefined: return true
    case 'string': return typeof v === 'string'
    case 'number': return typeof v === 'number' && Number.isFinite(v)
    case 'integer': return typeof v === 'number' && Number.isInteger(v)
    case 'boolean': return typeof v === 'boolean'
    case 'array': return Array.isArray(v)
    case 'object': return !!v && typeof v === 'object' && !Array.isArray(v)
    default: return false
  }
}

/** Checks the arguments against the tool's schema (types, required, enum, size). Unknown arguments are refused. */
export function checkArguments(schema: Schema, args: Record<string, unknown>): void {
  const props = schema.properties
  for (const r of schema.required ?? []) if (args[r] === undefined || args[r] === null) throw new RestToolError(`Parameter ${r} fehlt`)
  for (const [k, v] of Object.entries(args)) {
    // Own keys only: `constructor`, `toString`, `__proto__` etc. must not pass as declared parameters.
    const p = Object.hasOwn(props, k) ? props[k] : undefined
    if (!p) throw new RestToolError(`Unbekannter Parameter ${k}`)
    if (v === undefined || v === null) continue
    if (!typeOk(p.type, v)) throw new RestToolError(`Parameter ${k} muss ${p.type} sein`)
    if (typeof v === 'string' && v.length > Math.min(p.maxLength ?? REST_LIMITS.stringArg, REST_LIMITS.stringArg)) throw new RestToolError(`Parameter ${k} ist zu lang`)
    if (Array.isArray(p.enum) && !p.enum.some(e => e === v)) throw new RestToolError(`Parameter ${k}: Wert nicht erlaubt`)
  }
}

// ---------- Rendering ----------

const scalar = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v))
const enc = (v: unknown) => encodeURIComponent(scalar(v))

export type RenderedRequest = { url: string, method: RestMethod, headers: Record<string, string>, body: string | null }

export type RenderInput = {
  tool: Pick<CheckedRestTool, 'method' | 'urlTemplate' | 'headers' | 'bodyTemplate' | 'inputSchema'>
  baseUrl: string | null
  args: Record<string, unknown>
}

function renderBodyValue(node: unknown, args: Record<string, unknown>, used: Set<string>): unknown {
  if (typeof node === 'string') {
    const whole = /^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/.exec(node)
    if (whole) { used.add(whole[1]!); return args[whole[1]!] ?? null }
    return node.replace(PLACEHOLDER_RE, (_m, n: string) => { used.add(n); return args[n] === undefined || args[n] === null ? '' : scalar(args[n]) })
  }
  if (Array.isArray(node)) return node.map(x => renderBodyValue(x, args, used))
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, renderBodyValue(v, args, used)]))
  return node
}

export function renderRequest(i: RenderInput): RenderedRequest {
  const { tool, args } = i
  checkArguments(tool.inputSchema, args)
  const used = new Set<string>()
  const split = splitOrigin(tool.urlTemplate)
  let originStr: string
  let rest: string
  if (split) { originStr = split.origin; rest = split.rest } else {
    if (!i.baseUrl) throw new RestToolError('Basis-URL fehlt')
    const base = new URL(i.baseUrl)
    originStr = base.origin
    // Relative path: appended to the base URL's own path (`https://api.example.com/v1` + `/items` -> `/v1/items`)
    rest = base.pathname.replace(/\/+$/, '') + tool.urlTemplate
  }
  const [beforeHash] = rest.split('#')
  const qi = beforeHash!.indexOf('?')
  const pathTpl = qi < 0 ? beforeHash! : beforeHash!.slice(0, qi)
  const queryTpl = qi < 0 ? '' : beforeHash!.slice(qi + 1)
  const path = pathTpl.replace(PLACEHOLDER_RE, (_m, n: string) => {
    used.add(n)
    const v = args[n]
    if (v === undefined || v === null) throw new RestToolError(`Parameter ${n} fehlt`)
    const s = scalar(v)
    if (s === '' || s === '.' || s === '..') throw new RestToolError(`Parameter ${n}: Wert für den Pfad nicht erlaubt`)
    return encodeURIComponent(s)
  })
  const query: string[] = []
  for (const pair of queryTpl ? queryTpl.split('&') : []) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    const val = eq < 0 ? '' : pair.slice(eq + 1)
    const names = placeholders(val)
    if (names.length === 1 && val === `{${names[0]}}` && (args[names[0]!] === undefined || args[names[0]!] === null)) { used.add(names[0]!); continue }
    query.push(`${key}=${val.replace(PLACEHOLDER_RE, (_m, n: string) => {
      used.add(n)
      if (args[n] === undefined || args[n] === null) throw new RestToolError(`Parameter ${n} fehlt`)
      return enc(args[n])
    })}`)
  }
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(tool.headers)) {
    const hv = v.replace(PLACEHOLDER_RE, (_m, n: string) => {
      used.add(n)
      if (args[n] === undefined || args[n] === null) throw new RestToolError(`Parameter ${n} fehlt`)
      return scalar(args[n])
    })
    if (/[\r\n\0]/.test(hv)) throw new RestToolError(`Header ${k}: Wert enthält ein unzulässiges Zeichen`)
    headers[k] = hv
  }
  let body: string | null = null
  const bodyAllowed = tool.method !== 'GET' && tool.method !== 'DELETE'
  if (tool.bodyTemplate) body = JSON.stringify(renderBodyValue(JSON.parse(tool.bodyTemplate), args, used))
  // Arguments the template does not mention: JSON body for POST/PUT/PATCH, query string for GET/DELETE.
  const extra = Object.entries(args).filter(([k, v]) => !used.has(k) && v !== undefined && v !== null)
  if (extra.length) {
    if (bodyAllowed && !tool.bodyTemplate) body = JSON.stringify(Object.fromEntries(extra))
    else if (!bodyAllowed) {
      for (const [k, v] of extra) {
        if (v && typeof v === 'object' && !Array.isArray(v)) throw new RestToolError(`Parameter ${k}: Objekte sind in der Query nicht möglich`)
        for (const item of Array.isArray(v) ? v : [v]) query.push(`${encodeURIComponent(k)}=${enc(item)}`)
      }
    } else throw new RestToolError(`Parameter ${extra[0]![0]} wird vom Body-Template nicht verwendet`)
  }
  if (body !== null) {
    if (Buffer.byteLength(body) > REST_LIMITS.requestBodyBytes) throw new RestToolError('Anfrage zu groß')
    if (!Object.keys(headers).some(h => h.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
  }
  const url = `${originStr}${path.startsWith('/') ? '' : '/'}${path}${query.length ? `?${query.join('&')}` : ''}`
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new RestToolError('Die Adresse ist ungültig') }
  // Host injection can only happen if the origin changed; refuse instead of trusting URL normalization.
  if (parsed.origin.toLowerCase() !== new URL(originStr).origin.toLowerCase() || parsed.username || parsed.password) throw new RestToolError('Die Adresse verlässt das Ziel des Tools')
  return { url: parsed.href, method: tool.method, headers, body }
}
