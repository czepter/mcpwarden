import { admin } from 'better-auth/plugins'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { BetterAuthOptions } from 'better-auth'
import { canRegister } from './registration'

export interface AuthDeps {
  baseUrl: string
  secret: string
  allowedOrigins: string[]
  rateLimitEnabled: boolean
  countUsers: () => Promise<number>
}

/** Optionen ohne DB. Weitere Plugins (jwt, mcp) ergaenzt 0b hier. */
export function buildAuthOptions(d: AuthDeps) {
  return {
    baseURL: d.baseUrl,
    secret: d.secret,
    trustedOrigins: d.allowedOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    plugins: [admin()],
    rateLimit: {
      enabled: d.rateLimitEnabled,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email : ''
        const r = await canRegister({ email }, d.countUsers)
        if (!r.ok) throw new APIError('FORBIDDEN', { message: 'Registrierung geschlossen', code: r.code })
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Laeuft im Sign-up-Mutex (server/api/auth/[...all].ts): "zaehlen, anlegen" ist atomar.
          before: async (user) => {
            if ((await d.countUsers()) === 0) return { data: { ...user, role: 'admin' } }
          },
        },
      },
    },
  } satisfies BetterAuthOptions
}
