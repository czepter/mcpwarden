// Konfiguration aus process.env (Namen fix, Spec P0-10). Fail-fast: Fehler nennen nur Variablennamen, nie Werte.
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Ungueltige Konfiguration: ${problems.join('; ')}`)
    this.name = 'ConfigError'
  }
}

/** SMTP-Zugang aus SMTP_URL. `pass` ist nicht aufzaehlbar: taucht in JSON/Logs/console.log nie auf. */
export interface SmtpConfig {
  host: string
  port: number
  /** true = implizites TLS (smtps), false = STARTTLS (smtp; Klartext nur an Loopback). */
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
  /** Optionaler Mailversand (P1 "Mailer"). Ohne SMTP_URL bleibt alles Link-basiert. */
  smtp: SmtpConfig | undefined
  mailFrom: string | undefined
  /** Mindestabstand je (Upstream, Zustand) fuer Statusmails in Minuten (MAIL_NOTIFY_WINDOW_MIN, Default 60). */
  statusMailWindowMin: number
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseMasterKey(raw: string): Buffer | undefined {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const buf = Buffer.from(raw, 'base64')
    // Kanonisch: erneutes Kodieren muss den Eingabestring exakt ergeben (keine gesetzten Restbits).
    if (buf.length === 32 && buf.toString('base64') === raw) return buf
  }
  return undefined
}

// Einfache Absenderadresse: `a@b.c` oder `Name <a@b.c>`. Kein CR/LF, keine Steuerzeichen, keine weiteren Klammern.
const ADDR = '[^\\s@<>",;:()\\[\\]\\\\]+@[^\\s@<>",;:()\\[\\]\\\\]+\\.[^\\s@<>",;:()\\[\\]\\\\]+'
const MAIL_FROM_RE = new RegExp(`^(?:${ADDR}|[^<>"\\r\\n\\p{Cc}]{1,64}<${ADDR}>)$`, 'u')
export const isMailFrom = (v: string) => v.length <= 254 && MAIL_FROM_RE.test(v)

/** Meldet nur Variablennamen, nie Teile der URL. */
function parseSmtp(raw: string, problems: string[]): SmtpConfig | undefined {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    problems.push('SMTP_URL ist keine gueltige URL')
    return undefined
  }
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') {
    problems.push('SMTP_URL muss mit smtp:// oder smtps:// beginnen')
    return undefined
  }
  if (!u.hostname) {
    problems.push('SMTP_URL enthaelt keinen Host')
    return undefined
  }
  const secure = u.protocol === 'smtps:'
  const port = u.port ? Number(u.port) : secure ? 465 : 587
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    problems.push('SMTP_URL enthaelt einen ungueltigen Port')
    return undefined
  }
  if (u.pathname.replace(/\//g, '') || u.search || u.hash) {
    problems.push('SMTP_URL darf keinen Pfad, keine Query und kein Fragment enthalten')
    return undefined
  }
  let user: string | undefined
  let pass: string | undefined
  try {
    user = u.username ? decodeURIComponent(u.username) : undefined
    pass = u.password ? decodeURIComponent(u.password) : undefined
  } catch {
    problems.push('SMTP_URL enthaelt ungueltig kodierte Zugangsdaten')
    return undefined
  }
  if (pass && !user) {
    problems.push('SMTP_URL enthaelt ein Passwort ohne Benutzer')
    return undefined
  }
  if ([user, pass].some(v => v && /[\r\n]/.test(v))) {
    problems.push('SMTP_URL enthaelt Zeilenumbrueche in den Zugangsdaten')
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
  if (!rawBase) problems.push('BASE_URL fehlt')
  else {
    try {
      baseUrl = new URL(rawBase)
      if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new Error()
      if (baseUrl.protocol === 'http:' && !LOCAL_HOSTS.has(baseUrl.hostname)) {
        problems.push('BASE_URL muss https verwenden (http nur fuer localhost)')
      }
    } catch {
      baseUrl = undefined
      problems.push('BASE_URL ist keine gueltige URL')
    }
  }

  const betterAuthSecret = get('BETTER_AUTH_SECRET')
  if (!betterAuthSecret) problems.push('BETTER_AUTH_SECRET fehlt')
  else if (betterAuthSecret.length < 32) problems.push('BETTER_AUTH_SECRET muss mindestens 32 Zeichen haben')

  let masterKey: Buffer | undefined
  const rawKey = get('MASTER_KEY')
  if (!rawKey) problems.push('MASTER_KEY fehlt')
  else {
    masterKey = parseMasterKey(rawKey)
    if (!masterKey) problems.push('MASTER_KEY muss 32 Byte als Base64 oder 64 Hex-Zeichen sein')
  }

  const databaseUrl = get('DATABASE_URL')
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    problems.push('DATABASE_URL muss mit postgres:// oder postgresql:// beginnen')
  }

  const rateLimit = get('RATE_LIMIT')
  if (rateLimit && rateLimit !== 'off') problems.push('RATE_LIMIT darf nur "off" oder leer sein')

  let allowedOrigins: string[] = []
  const rawOrigins = get('ALLOWED_ORIGINS')
  if (rawOrigins) {
    for (const o of rawOrigins.split(',').map(s => s.trim()).filter(Boolean)) {
      try {
        allowedOrigins.push(new URL(o).origin)
      } catch {
        problems.push('ALLOWED_ORIGINS enthaelt einen ungueltigen Eintrag')
      }
    }
  } else if (baseUrl) allowedOrigins = [baseUrl.origin]

  let smtp: SmtpConfig | undefined
  let mailFrom: string | undefined
  const rawSmtp = get('SMTP_URL')
  if (rawSmtp) {
    smtp = parseSmtp(rawSmtp, problems)
    mailFrom = get('MAIL_FROM')
    if (!mailFrom) problems.push('MAIL_FROM fehlt (Pflicht, wenn SMTP_URL gesetzt ist)')
    else if (!isMailFrom(mailFrom)) problems.push('MAIL_FROM ist keine gueltige Absenderadresse')
  }

  let statusMailWindowMin = 60
  const rawWindow = get('MAIL_NOTIFY_WINDOW_MIN')
  if (rawWindow) {
    const n = Number(rawWindow)
    if (!/^\d+$/.test(rawWindow) || n < 1 || n > 10_080) problems.push('MAIL_NOTIFY_WINDOW_MIN muss eine ganze Zahl von 1 bis 10080 sein')
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
    smtp,
    mailFrom,
    statusMailWindowMin,
  })
}

let cached: AppConfig | undefined
export function getConfig(): AppConfig {
  return (cached ??= parseConfig(process.env))
}
