import { admin } from 'better-auth/plugins'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { BetterAuthOptions } from 'better-auth'
import { INVITE_INVALID } from '../../shared/api-types'
import { canRegister, type InviteCheck } from './registration'
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
  /** Einladungen (Phase 1): Prüfung vor dem Anlegen, atomarer Verbrauch beim Anlegen, Bindung danach. Fehlt beim Schema-CLI. */
  invites?: {
    check: InviteCheck
    claim: (token: string, email: string) => Promise<string | null>
    bind: (inviteId: string, userId: string) => Promise<void>
  }
}

/** Token je E-Mail zwischen Before-Hook und Anlegen; Sign-ups laufen seriell (Mutex in api/auth/[...all].ts). */
const pendingInvites = new Map<string, { token: string, at: number }>()
const PENDING_TTL_MS = 60_000

/** Optionen ohne DB. 0b ergaenzt `jwt()` und `mcp()` (Spike-Ergebnisse: server/auth/mcp-plugin.ts). */
const claimed = new Map<string, string>() // E-Mail -> beanspruchte Einladung bis zum Anlegen

export function buildAuthOptions(d: AuthDeps) {
  const resource = mcpResource(d.baseUrl)
  return {
    baseURL: d.baseUrl,
    secret: d.secret,
    trustedOrigins: d.allowedOrigins,
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
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
        const inviteToken = ctx.headers?.get('x-invite-token')?.trim() || undefined
        const r = await canRegister({ email, inviteToken }, d.countUsers, d.invites?.check)
        if (!r.ok) throw new APIError('FORBIDDEN', { message: 'Registrierung nicht möglich', code: r.code })
        const now = Date.now()
        for (const [k, v] of pendingInvites) if (now - v.at > PENDING_TTL_MS) pendingInvites.delete(k)
        if (inviteToken) pendingInvites.set(email.toLowerCase(), { token: inviteToken, at: now })
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (d.dcr) await dcrAfter(ctx.path, ctx.body, ctx.context.returned, d.dcr)
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Laeuft im Sign-up-Mutex (server/api/auth/[...all].ts): "zaehlen, anlegen" ist atomar.
          before: async (user, context) => {
            if ((await d.countUsers()) === 0) return { data: { ...user, role: 'admin' } }
            // Nur die öffentliche Registrierung braucht eine Einladung; Admin-Anlage (create-user) ist durch die Admin-Prüfung geschützt
            if (context?.path !== '/sign-up/email') return
            // Eingeladene bekommen immer die Rolle user; der Verbrauch ist atomar (bedingtes UPDATE), der Verlierer eines Rennens scheitert
            const key = user.email.toLowerCase()
            const pending = pendingInvites.get(key)
            pendingInvites.delete(key)
            const id = pending && d.invites ? await d.invites.claim(pending.token, user.email) : null
            if (!id) throw new APIError('FORBIDDEN', { message: 'Einladung ungültig', code: INVITE_INVALID })
            claimed.set(key, id)
            return { data: { ...user, role: 'user' } }
          },
          after: async (user) => {
            const id = claimed.get(user.email.toLowerCase())
            claimed.delete(user.email.toLowerCase())
            if (id) await d.invites?.bind(id, user.id)
          },
        },
      },
    },
  } satisfies BetterAuthOptions
}
