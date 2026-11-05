import { admin } from 'better-auth/plugins'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { BetterAuthOptions } from 'better-auth'
import { INVITE_INVALID } from '../../shared/api-types'
import { trySendMail, type Mailer } from '../mail'
import { RESET_TTL_MINUTES, resetPasswordMail } from '../mail/templates'
import { canRegister, type InviteCheck } from './registration'
import { dcrAfter, dcrBefore, type DcrDeps } from './dcr-hook'
import { CLIENT_IP_HEADER } from '../utils/client-ip'
import { isBlockedOverHttp } from './http-guard'
import { consentGuard, mcpPlugins, mcpResource, oauthRequestRewrite } from './mcp-plugin'

export interface AuthDeps {
  baseUrl: string
  secret: string
  allowedOrigins: string[]
  rateLimitEnabled: boolean
  /** Number of trusted proxy hops (TRUST_PROXY), 0 = X-Forwarded-* is ignored. */
  trustProxy: number
  countUsers: () => Promise<number>
  /** DCR policy and registration log (DB). Missing in the schema CLI. */
  dcr?: DcrDeps
  /** Invitations (phase 1): check before creating, atomic consumption on creation, binding afterwards. Missing in the schema CLI. */
  invites?: {
    check: InviteCheck
    claim: (token: string, email: string) => Promise<string | null>
    bind: (inviteId: string, userId: string) => Promise<void>
    /** Releases a claimed invitation if creating the user fails afterwards. */
    release: (inviteId: string) => Promise<void>
  }
  /**
   * Safety net: banning/deleting via any Better Auth path (including direct calls) triggers the same cleanup chain (revoking credentials, then runtime resources)
   * as the mcpwarden admin routes (pool, worker, PATs, OAuth grants). Must be idempotent.
   */
  lifecycle?: { onUserBanned: (userId: string) => Promise<void> }
  /** Optional. Only an enabled mailer switches on password reset by mail. */
  mailer?: Mailer
}

/**
 * Password reset by mail (only with an active mailer). The response is the same for known and unknown addresses
 * (Better Auth); the send is not awaited so that SMTP latency does not reveal whether the address exists.
 * The link comes from BASE_URL, not from the request's `url`/`redirectTo`. The token is never logged.
 */
function passwordReset(baseUrl: string, mailer: Mailer) {
  return {
    resetPasswordTokenExpiresIn: RESET_TTL_MINUTES * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }: { user: { email: string }, token: string }) => {
      void trySendMail(mailer, resetPasswordMail(user.email, baseUrl, token), 'password reset')
    },
  }
}

/** Token per email between the before hook and creation; sign-ups run serially (mutex in api/auth/[...all].ts). */
const pendingInvites = new Map<string, { token: string, at: number }>()
const PENDING_TTL_MS = 60_000

/** Options without DB. 0b adds `jwt()` and `mcp()` (spike results: server/auth/mcp-plugin.ts). */
const claimed = new Map<string, string>() // email -> claimed invitation until creation

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
    advanced: {
      // The client IP is resolved by server/utils/client-ip.ts (socket address or trusted proxy hop) and passed through in the internal header;
      // Better Auth never reads X-Forwarded-For itself (otherwise every rate limit could be bypassed with a forged header).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      // X-Forwarded-Host/-Proto only behind a trusted proxy (the base URL stays BASE_URL)
      trustedProxyHeaders: d.trustProxy > 0,
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
        // Only HTTP requests carry a request; server-side auth.api.* calls (mcpwarden admin routes) do not
        if (ctx.request && isBlockedOverHttp(ctx.path)) throw new APIError('NOT_FOUND', { message: 'Not found' })
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
        // An entry in `claimed` survives only if creation failed after claiming (`user.create.after` otherwise cleans it up):
        // release the invitation again, otherwise it is burned for the invitee.
        if (ctx.path === '/sign-up/email') {
          const key = (typeof ctx.body?.email === 'string' ? ctx.body.email : '').toLowerCase()
          const id = claimed.get(key)
          claimed.delete(key)
          if (id) await d.invites?.release(id).catch(() => console.error('[mcpwarden] invitation could not be released'))
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Runs in the sign-up mutex (server/api/auth/[...all].ts): "count, create" is atomic.
          before: async (user, context) => {
            if ((await d.countUsers()) === 0) return { data: { ...user, role: 'admin' } }
            // Only public sign-up needs an invitation; admin creation (create-user) is protected by the admin check
            if (context?.path !== '/sign-up/email') return
            // Invitees always get the role user; consumption is atomic (conditional UPDATE), the loser of a race fails
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
        update: {
          after: async (user) => {
            if (user?.banned === true) await d.lifecycle?.onUserBanned(user.id as string)
          },
        },
        delete: {
          before: async (user) => {
            await d.lifecycle?.onUserBanned(user.id as string)
          },
        },
      },
    },
  } satisfies BetterAuthOptions
}
