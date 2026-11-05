import { HttpResponse, delay, http } from 'msw'
import type { HttpResponseResolver, PathParams } from 'msw'
import { getState, role, scenario } from './state'

export type Domain = 'auth' | 'oauth' | 'me' | 'admin-oauth' | 'upstreams' | 'admin' | 'audit' | 'dashboard' | 'stats' | 'links'
export const ALL_DOMAINS: Domain[] = ['auth', 'oauth', 'me', 'admin-oauth', 'upstreams', 'admin', 'audit', 'dashboard', 'stats', 'links']
/** Mock latency can be switched off (tests): window.__mockNoDelay or globalThis. */
export const noDelay = () => (globalThis as { __mockNoDelay?: boolean }).__mockNoDelay === true

export const err = (status: number, code: string, message: string, field?: string) =>
  HttpResponse.json({ statusCode: status, statusMessage: message, data: { code, message, field } }, { status })

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete'
export type Ctx = { params: PathParams, request: Request }

/** A handler with scenarios (slow, error, forbidden) and random delay. */
export function route(method: Method, path: string, fn: (c: Ctx) => Response | Promise<Response>, opts: { admin?: boolean, public?: boolean } = {}) {
  const resolver: HttpResponseResolver = async ({ params, request }) => {
    const sc = scenario()
    if (!noDelay()) await delay(sc === 'slow' ? 2500 : 150 + Math.random() * 350)
    if (!opts.public && !getState().signedIn) return err(401, 'unauthorized', 'Nicht angemeldet.')
    if (sc === 'error' && !opts.public) return err(500, 'internal', 'Interner Fehler im Mock-Szenario „error“.')
    if (sc === 'forbidden' && !opts.public && method === 'get') return err(403, 'forbidden', 'Zugriff verweigert (Mock-Szenario „forbidden“).')
    if (opts.admin && role() !== 'admin') return err(403, 'forbidden', 'Nur für Admins.')
    return fn({ params, request })
  }
  return http[method](path, resolver)
}
export const json = <T>(body: T, status = 200) => HttpResponse.json(body as never, { status })
export const noContent = () => new HttpResponse(null, { status: 204 })
export const body = async <T>(r: Request) => (await r.json().catch(() => ({}))) as T
export const nid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`
