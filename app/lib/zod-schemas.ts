/**
 * Spike result (task 2): @vee-validate/zod 4.15.1 `toTypedSchema` works with zod 4.6.7
 * (verified by tests/ui/unit/zod-schemas.test.ts, validation and error paths). Fallback not needed.
 */
import { z } from 'zod'
import { t } from '~/lib/i18n'

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
export const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/
const email = z.string().trim().min(1, { error: () => t('common.validation.emailRequired') }).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { error: () => t('common.validation.emailInvalid') })
const password12 = z.string().min(12, { error: () => t('common.validation.min12') })

export const loginSchema = z.object({ email, password: z.string().min(1, { error: () => t('common.validation.passwordRequired') }) })

export const forgotSchema = z.object({ email })
export const resetSchema = z.object({ password: password12, confirm: z.string() })
  .refine(v => v.password === v.confirm, { path: ['confirm'], error: () => t('common.validation.passwordMismatch') })

export const signUpSchema = z.object({
  name: z.string().trim().min(1, { error: () => t('common.validation.nameRequired') }),
  email, password: password12, confirm: z.string(),
}).refine(v => v.password === v.confirm, { path: ['confirm'], error: () => t('common.validation.passwordMismatch') })

export const nameSchema = z.object({ name: z.string().trim().min(1, { error: () => t('common.validation.nameEmpty') }) })
export const passwordChangeSchema = z.object({ current: z.string().min(1, { error: () => t('common.validation.currentPasswordRequired') }), next: password12 })
export const patSchema = z.object({ name: z.string().trim().min(1, { error: () => t('common.validation.tokenNameRequired') }).max(64, { error: () => t('common.validation.max64') }) })
export const inviteSchema = z.object({ email: z.string().trim().refine(v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { error: () => t('common.validation.emailInvalid') }) })
export const secretSchema = z.object({ value: z.string().min(1, { error: () => t('common.validation.valueRequired') }) })

const posInt = (label: () => string) => {
  const error = () => t('common.validation.posInt', { label: label() })
  return z.coerce.number({ error }).int({ error }).min(1, { error })
}
export const limitsSchema = z.object({
  maxUpstreams: posInt(() => t('common.validation.limits.upstreams')), callsPerMin: posInt(() => t('common.validation.limits.callsPerMin')), maxConnections: posInt(() => t('common.validation.limits.connections')),
  stdioMaxProcs: posInt(() => t('common.validation.limits.stdioProcs')), stdioIdleMin: posInt(() => t('common.validation.limits.stdioIdle')),
})
export const allowlistSchema = z.object({
  label: z.string().trim().min(1, { error: () => t('common.validation.labelMissing') }),
  namePattern: z.string().trim().min(1, { error: () => t('common.validation.patternMissing') }),
  redirects: z.string().refine(v => v.split('\n').some(l => l.trim()), { error: () => t('common.validation.redirectMissing') }),
})

export const upstreamSchema = z.object({
  type: z.enum(['http', 'stdio', 'rest']),
  name: z.string().trim().min(1, { error: () => t('common.validation.displayNameEmpty') }),
  slug: z.string().regex(SLUG_RE, { error: () => t('common.validation.slug') }),
  url: z.string(), transport: z.enum(['auto', 'streamable', 'sse']),
  authType: z.enum(['none', 'bearer', 'header', 'oauth']), authHeaderName: z.string(), secret: z.string(),
  command: z.string(), args: z.string(), cwd: z.string(),
  ratePerMin: posInt(() => t('common.validation.limits.callsPerMin')), maxConcurrent: posInt(() => t('common.validation.limits.concurrent')),
  connectS: posInt(() => t('common.validation.limits.connect')), listS: posInt(() => t('common.validation.limits.list')), callS: posInt(() => t('common.validation.limits.call')),
}).superRefine((v, ctx) => {
  const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (v.type === 'http') {
    if (!/^https?:\/\/[^/@\s]+(\/\S*)?$/.test(v.url.trim())) add('url', t('common.validation.url'))
    if (v.authType === 'header' && !HEADER_RE.test(v.authHeaderName)) add('authHeaderName', t('common.validation.headerName'))
  }
  if (v.type === 'rest') {
    // The base URL is optional (tools may carry absolute URLs); when given it must be a valid http(s) address.
    if (v.url.trim() && !/^https?:\/\/[^/@\s]+(\/\S*)?$/.test(v.url.trim())) add('url', t('common.validation.url'))
    if (v.authType === 'header' && !HEADER_RE.test(v.authHeaderName)) add('authHeaderName', t('common.validation.headerName'))
  }
  if (v.type === 'stdio') {
    if (!v.command.trim()) add('command', t('common.validation.commandEmpty'))
    if (v.cwd && (v.cwd.startsWith('/') || v.cwd.split('/').includes('..'))) add('cwd', t('common.validation.cwd'))
  }
  for (const [k, max] of [['connectS', 600], ['listS', 600], ['callS', 600]] as const) if (v[k] > max) add(k, t('common.validation.max600'))
})
