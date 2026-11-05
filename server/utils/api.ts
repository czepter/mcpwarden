import { createError, sendNoContent, setHeader, type H3Event } from 'h3'

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 500: 'Internal Server Error' }

/** Error shape `ApiErrorBody` (plan 0b E19): { statusCode, statusMessage, data: { code, field?, message } }. */
export function apiError(statusCode: number, code: string, message: string, field?: string) {
  return createError({ statusCode, statusMessage: STATUS_TEXT[statusCode] ?? 'Error', data: { code, message, ...(field ? { field } : {}) } })
}

/** Never cache lists and secret-adjacent responses. */
export function noStore(event: H3Event): void {
  setHeader(event, 'cache-control', 'no-store')
}

export function noContent(event: H3Event) {
  return sendNoContent(event, 204)
}

/** JSON object from the body, or `{}` for a missing/invalid body. */
export async function readObject(event: H3Event): Promise<Record<string, unknown>> {
  try {
    const b = await readBody(event)
    return b && typeof b === 'object' && !Array.isArray(b) ? b as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
