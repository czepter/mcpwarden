// Konfiguration aus process.env (Namen fix, Spec P0-10). Fail-fast: Fehler nennen nur Variablennamen, nie Werte.
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Ungueltige Konfiguration: ${problems.join('; ')}`)
    this.name = 'ConfigError'
  }
}

export interface AppConfig {
  baseUrl: URL
  betterAuthSecret: string
  masterKey: Buffer
  databaseUrl: string | undefined
  dataDir: string
  allowedOrigins: string[]
  rateLimitEnabled: boolean
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseMasterKey(raw: string): Buffer | undefined {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const buf = Buffer.from(raw, 'base64')
    if (buf.length === 32) return buf
  }
  return undefined
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

  if (problems.length || !baseUrl || !betterAuthSecret || !masterKey) throw new ConfigError(problems)

  return Object.freeze({
    baseUrl,
    betterAuthSecret,
    masterKey,
    databaseUrl,
    dataDir: get('DATA_DIR') ?? './data',
    allowedOrigins,
    rateLimitEnabled: rateLimit !== 'off',
  })
}

let cached: AppConfig | undefined
export function getConfig(): AppConfig {
  return (cached ??= parseConfig(process.env))
}
