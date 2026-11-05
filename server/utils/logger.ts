/** Structured logger with redaction (plan 1.1.3). Secrets, tokens and invite links never appear in the log. */
const SENSITIVE_KEY = /(authorization|secret|token|password|cookie|api[-_]?key|x-invite-token|ciphertext|master)/i
const REDACTED = '[redacted]'

/** `/invite/<token>` and `/api/invites/<token>` are masked in access logs. */
export const maskPath = (p: string) => p.replace(/(\/(?:api\/)?invites?\/)[^/?#\s]+/g, '$1[token]')

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]'
  if (typeof value === 'string') return maskPath(value)
  if (Array.isArray(value)) return value.map(v => redact(v, depth + 1))
  if (value instanceof Error) return { name: value.name, message: maskPath(value.message) }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1)]))
  }
  return value
}

type Level = 'debug' | 'info' | 'warn' | 'error'
export function createLogger(write: (line: string) => void = l => process.stdout.write(`${l}\n`)) {
  const log = (level: Level, msg: string, fields: Record<string, unknown> = {}) =>
    write(JSON.stringify({ ts: new Date().toISOString(), level, msg: maskPath(msg), ...(redact(fields) as object) }))
  return {
    debug: (m: string, f?: Record<string, unknown>) => log('debug', m, f),
    info: (m: string, f?: Record<string, unknown>) => log('info', m, f),
    warn: (m: string, f?: Record<string, unknown>) => log('warn', m, f),
    error: (m: string, f?: Record<string, unknown>) => log('error', m, f),
  }
}
export const logger = createLogger()
