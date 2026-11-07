import type { ApiErrorBody } from '#shared/api-types'
import { t } from '~/lib/i18n'

export class ApiError extends Error {
  statusCode: number
  code: string
  field?: string
  constructor(statusCode: number, code: string, message: string, field?: string) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.field = field
  }

  get forbidden() { return this.statusCode === 403 }
  get notFound() { return this.statusCode === 404 }
}

let onUnauthorized: (() => void) | null = null
/** Set by the auth plugin: 401 leads to /login. */
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn }

export async function http<T>(method: string, path: string, opts: { body?: unknown, query?: Record<string, string | number | undefined>, headers?: Record<string, string>, skip401?: boolean } = {}): Promise<T> {
  let url = path
  if (opts.query) {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== '') q.set(k, String(v))
    const qs = q.toString()
    if (qs) url += (path.includes('?') ? '&' : '?') + qs
  }
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let json: unknown
  try { json = text ? JSON.parse(text) : undefined } catch { json = undefined }
  if (!res.ok) {
    if (res.status === 401 && !opts.skip401) onUnauthorized?.()
    const b = json as Partial<ApiErrorBody> & { message?: string, code?: string } | undefined
    throw new ApiError(res.status, b?.data?.code ?? b?.code ?? 'unknown', b?.data?.message ?? b?.statusMessage ?? b?.message ?? t('common.errorStatus', { status: res.status }), b?.data?.field)
  }
  return json as T
}

export const get = <T>(p: string, query?: Record<string, string | number | undefined>) => http<T>('GET', p, { query })
export const post = <T>(p: string, body?: unknown, headers?: Record<string, string>) => http<T>('POST', p, { body: body ?? {}, headers })
export const put = <T>(p: string, body: unknown) => http<T>('PUT', p, { body })
export const patch = <T>(p: string, body: unknown) => http<T>('PATCH', p, { body })
export const del = <T = void>(p: string) => http<T>('DELETE', p)
