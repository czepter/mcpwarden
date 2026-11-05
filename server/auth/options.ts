import { admin } from 'better-auth/plugins'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { BetterAuthOptions } from 'better-auth'
import { trySendMail, type Mailer } from '../mail'
import { RESET_TTL_MINUTES, resetPasswordMail } from '../mail/templates'
import { canRegister } from './registration'
import { dcrAfter, dcrBefore, type DcrDeps } from './dcr-hook'
import { consentGuard, mcpPlugins, mcpResource, oauthRequestRewrite } from './mcp-plugin'

export interface AuthDeps {
  baseUrl: string
  secret: string
  allowedOrigins: string[]
  rateLimitEnabled: boolean
  countUsers: () => Promise<number>
  /** DCR-Policy und Registrierungsprotokoll (DB). Fehlt beim Schema-CLI. */
  dcr?: DcrDeps
  /** Optional. Nur ein aktivierter Mailer schaltet Passwort-Reset per Mail ein. */
  mailer?: Mailer
}

/**
 * Passwort-Reset per Mail (nur mit aktivem Mailer). Antwort ist fuer bekannte und unbekannte Adressen gleich
 * (Better Auth); der Versand wird nicht abgewartet, damit SMTP-Latenz nicht verraet, ob die Adresse existiert.
 * Der Link kommt aus BASE_URL, nicht aus `url`/`redirectTo` der Anfrage. Das Token wird nie geloggt.
 */
function passwordReset(baseUrl: string, mailer: Mailer) {
  return {
    resetPasswordTokenExpiresIn: RESET_TTL_MINUTES * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }: { user: { email: string }, token: string }) => {
      void trySendMail(mailer, resetPasswordMail(user.email, baseUrl, token), 'Passwort-Reset')
    },
  }
}

/** Optionen ohne DB. 0b ergaenzt `jwt()` und `mcp()` (Spike-Ergebnisse: server/auth/mcp-plugin.ts). */
export function buildAuthOptions(d: AuthDeps) {
  const resource = mcpResource(d.baseUrl)
  return {
    baseURL: d.baseUrl,
    secret: d.secret,
    trustedOrigins: d.allowedOrigins,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      ...(d.mailer?.enabled ? passwordReset(d.baseUrl, d.mailer) : {}),
    },
    plugins: [admin(), ...mcpPlugins(d.baseUrl)],
    rateLimit: {
      enabled: d.rateLimitEnabled,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        consentGuard(ctx.path, ctx.body)
        if (d.dcr) await dcrBefore(ctx.path, ctx.body, d.dcr)
        const oauth = oauthRequestRewrite(ctx.path, ctx.query, ctx.body, resource)
        if (oauth) return { context: oauth }
        if (ctx.path !== '/sign-up/email') return
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email : ''
        const r = await canRegister({ email }, d.countUsers)
        if (!r.ok) throw new APIError('FORBIDDEN', { message: 'Registrierung geschlossen', code: r.code })
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (d.dcr) await dcrAfter(ctx.path, ctx.body, ctx.context.returned, d.dcr)
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
