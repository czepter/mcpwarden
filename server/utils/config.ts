// Configuration from process.env (fixed names, spec P0-10). Fail fast: errors name only variable names, never values.
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration: ${problems.join('; ')}`)
    this.name = 'ConfigError'
  }
}

/** SMTP access from SMTP_URL. `pass` is not enumerable: it never shows up in JSON/logs/console.log. */
export interface SmtpConfig {
  host: string
  port: number
  /** true = implicit TLS (smtps), false = STARTTLS (smtp; plaintext only on loopback). */
  secure: boolean
  user: string | undefined
  readonly pass: string | undefined
}

export interface AppConfig {
  baseUrl: URL
  betterAuthSecret: string
  masterKey: Buffer
  databaseUrl: string | undefined
  dataDir: string
  allowedOrigins: string[]
  rateLimitEnabled: boolean
  /**
   * Number of trusted reverse-proxy hops in front of the app (TRUST_PROXY). 0 = none: X-Forwarded-* is ignored, the client IP is the
   * socket address. `true` = 1 (one proxy appends the client IP to X-Forwarded-For); a number N for N chained proxies.
   */
  trustProxy: number
  /** Optional mail sending (P1 "Mailer"). Without SMTP_URL everything stays link-based. */
  smtp: SmtpConfig | undefined
  mailFrom: string | undefined
  /** Minimum spacing per (upstream, state) for status mails in minutes (MAIL_NOTIFY_WINDOW_MIN, default 60). */
  statusMailWindowMin: number
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseMasterKey(raw: string): Buffer | undefined {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const buf = Buffer.from(raw, 'base64')
    // Canonical: re-encoding must reproduce the input string exactly (no stray remaining bits set).
    if (buf.length === 32 && buf.toString('base64') === raw) return buf
  }
  return undefined
}

// Simple sender address: `a@b.c` or `Name <a@b.c>`. No CR/LF, no control characters, no further brackets.
const ADDR = '[^\\s@<>",;:()\\[\\]\\\\]+@[^\\s@<>",;:()\\[\\]\\\\]+\\.[^\\s@<>",;:()\\[\\]\\\\]+'
const MAIL_FROM_RE = new RegExp(`^(?:${ADDR}|[^<>"\\r\\n\\p{Cc}]{1,64}<${ADDR}>)$`, 'u')
export const isMailFrom = (v: string) => v.length <= 254 && MAIL_FROM_RE.test(v)

/** Reports only variable names, never parts of the URL. */
function parseSmtp(raw: string, problems: string[]): SmtpConfig | undefined {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    problems.push('SMTP_URL is not a valid URL')
    return undefined
  }
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') {
    problems.push('SMTP_URL must start with smtp:// or smtps://')
    return undefined
  }
  if (!u.hostname) {
    problems.push('SMTP_URL contains no host')
    return undefined
  }
  const secure = u.protocol === 'smtps:'
  const port = u.port ? Number(u.port) : secure ? 465 : 587
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('SMTP_URL contains an invalid port')
    return undefined
  }
  if (u.pathname.replace(/\//g, '') || u.search || u.hash) {
    problems.push('SMTP_URL must not contain a path, query or fragment')
    return undefined
  }
  let user: string | undefined
  let pass: string | undefined
  try {
    user = u.username ? decodeURIComponent(u.username) : undefined
    pass = u.password ? decodeURIComponent(u.password) : undefined
  } catch {
    problems.push('SMTP_URL contains invalidly encoded credentials')
    return undefined
  }
  if (pass && !user) {
    problems.push('SMTP_URL contains a password without a user')
    return undefined
  }
  if ([user, pass].some(v => v && /[\r\n]/.test(v))) {
    problems.push('SMTP_URL contains line breaks in the credentials')
    return undefined
  }
  const cfg = { host: u.hostname.replace(/^\[|\]$/g, ''), port, secure, user } as SmtpConfig
  Object.defineProperty(cfg, 'pass', { value: pass, enumerable: false })
  return cfg
}

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const problems: string[] = []
  const get = (k: string) => env[k]?.trim() || undefined

  let baseUrl: URL | undefined
  const rawBase = get('BASE_URL')
  if (!rawBase) problems.push('BASE_URL is missing')
  else {
    try {
      baseUrl = new URL(rawBase)
      if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error()
      if (baseUrl.protocol === 'http:' && !LOCAL_HOSTS.has(baseUrl.hostname)) {
        problems.push('BASE_URL must use https (http only for localhost)')
      }
    } catch {
      baseUrl = undefined
      problems.push('BASE_URL is not a valid URL')
    }
  }

  const betterAuthSecret = get('BETTER_AUTH_SECRET')
  if (!betterAuthSecret) problems.push('BETTER_AUTH_SECRET is missing')
  else if (betterAuthSecret.length < 32) problems.push('BETTER_AUTH_SECRET must have at least 32 characters')

  let masterKey: Buffer | undefined
  const rawKey = get('MASTER_KEY')
  if (!rawKey) problems.push('MASTER_KEY is missing')
  else {
    masterKey = parseMasterKey(rawKey)
    if (!masterKey) problems.push('MASTER_KEY must be 32 bytes as Base64 or 64 hex characters')
  }

  const databaseUrl = get('DATABASE_URL')
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL must start with postgres:// or postgresql://')
  }

  const rateLimit = get('RATE_LIMIT')
  if (rateLimit && rateLimit !== 'off') problems.push('RATE_LIMIT may only be "off" or empty')

  let trustProxy = 0
  const rawTrust = get('TRUST_PROXY')?.toLowerCase()
  if (rawTrust && rawTrust !== 'false' && rawTrust !== '0') {
    if (rawTrust === 'true') trustProxy = 1
    else if (/^[1-9]\d?$/.test(rawTrust)) trustProxy = Number(rawTrust)
    else problems.push('TRUST_PROXY must be true, false or the number of proxy hops (1 to 99)')
  }

  let allowedOrigins: string[] = []
  const rawOrigins = get('ALLOWED_ORIGINS')
  if (rawOrigins) {
    for (const o of rawOrigins.split(',').map(s => s.trim()).filter(Boolean)) {
      try {
        allowedOrigins.push(new URL(o).origin)
      } catch {
        problems.push('ALLOWED_ORIGINS contains an invalid entry')
      }
    }
  } else if (baseUrl) allowedOrigins = [baseUrl.origin]

  let smtp: SmtpConfig | undefined
  let mailFrom: string | undefined
  const rawSmtp = get('SMTP_URL')
  if (rawSmtp) {
    smtp = parseSmtp(rawSmtp, problems)
    mailFrom = get('MAIL_FROM')
    if (!mailFrom) problems.push('MAIL_FROM is missing (required when SMTP_URL is set)')
    else if (!isMailFrom(mailFrom)) problems.push('MAIL_FROM is not a valid sender address')
  }

  let statusMailWindowMin = 60
  const rawWindow = get('MAIL_NOTIFY_WINDOW_MIN')
  if (rawWindow) {
    const n = Number(rawWindow)
    if (!/^\d+$/.test(rawWindow) || n < 1 || n > 10_080) problems.push('MAIL_NOTIFY_WINDOW_MIN must be an integer from 1 to 10080')
    else statusMailWindowMin = n
  }

  if (problems.length || !baseUrl || !betterAuthSecret || !masterKey) throw new ConfigError(problems)

  return Object.freeze({
    baseUrl,
    betterAuthSecret,
    masterKey,
    databaseUrl,
    dataDir: get('DATA_DIR') ?? './data',
    allowedOrigins,
    rateLimitEnabled: rateLimit !== 'off',
    trustProxy,
    smtp,
    mailFrom,
    statusMailWindowMin,
  })
}

let cached: AppConfig | undefined
export function getConfig(): AppConfig {
  return (cached ??= parseConfig(process.env))
}
