// Nur fuer `auth generate` (scripts/gen-auth-schema.sh). Wird nie zur Laufzeit geladen.
// Relative Imports, gueltige baseURL (sonst Abbruch "Invalid URL").
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { buildAuthOptions } from './options'

export const auth = betterAuth({
  ...buildAuthOptions({
    baseUrl: 'http://localhost:3000',
    secret: 'cli-dummy-secret-cli-dummy-secret-0000',
    allowedOrigins: ['http://localhost:3000'],
    rateLimitEnabled: false,
    countUsers: async () => 0,
  }),
  database: drizzleAdapter({} as never, { provider: 'pg' }),
})
