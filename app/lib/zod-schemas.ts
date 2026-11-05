/**
 * Spike-Ergebnis (Aufgabe 2): @vee-validate/zod 4.15.1 `toTypedSchema` laeuft mit zod 4.6.7
 * (geprueft durch tests/ui/unit/zod-schemas.test.ts, Validierung und Fehlerpfade). Fallback nicht noetig.
 */
import { z } from 'zod'

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
export const HEADER_RE = /^[A-Za-z0-9-]{1,64}$/
const email = z.string().trim().min(1, 'Bitte gib eine E-Mail-Adresse ein.').regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Das ist keine gültige E-Mail-Adresse.')
const password12 = z.string().min(12, 'Mindestens 12 Zeichen.')

export const loginSchema = z.object({ email, password: z.string().min(1, 'Bitte gib dein Passwort ein.') })

export const forgotSchema = z.object({ email })
export const resetSchema = z.object({ password: password12, confirm: z.string() })
  .refine(v => v.password === v.confirm, { path: ['confirm'], message: 'Die Passwörter stimmen nicht überein.' })

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'Bitte gib deinen Namen ein.'),
  email, password: password12, confirm: z.string(),
}).refine(v => v.password === v.confirm, { path: ['confirm'], message: 'Die Passwörter stimmen nicht überein.' })

export const nameSchema = z.object({ name: z.string().trim().min(1, 'Der Name darf nicht leer sein.') })
export const passwordChangeSchema = z.object({ current: z.string().min(1, 'Bitte gib dein aktuelles Passwort ein.'), next: password12 })
export const patSchema = z.object({ name: z.string().trim().min(1, 'Bitte vergib einen Namen.').max(64, 'Höchstens 64 Zeichen.') })
export const inviteSchema = z.object({ email: z.string().trim().refine(v => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Das ist keine gültige E-Mail-Adresse.') })
export const secretSchema = z.object({ value: z.string().min(1, 'Bitte gib den Wert ein.') })

const posInt = (label: string) => z.coerce.number({ message: `${label}: ganze Zahl ab 1.` }).int(`${label}: ganze Zahl ab 1.`).min(1, `${label}: ganze Zahl ab 1.`)
export const limitsSchema = z.object({
  maxUpstreams: posInt('Upstreams'), callsPerMin: posInt('Aufrufe pro Minute'), maxConnections: posInt('Verbindungen'),
  stdioMaxProcs: posInt('stdio-Prozesse'), stdioIdleMin: posInt('stdio-Leerlauf'),
})
export const allowlistSchema = z.object({
  label: z.string().trim().min(1, 'Bezeichnung fehlt.'),
  namePattern: z.string().trim().min(1, 'Name-Muster fehlt.'),
  redirects: z.string().refine(v => v.split('\n').some(l => l.trim()), 'Mindestens ein Redirect-Muster.'),
})

export const upstreamSchema = z.object({
  type: z.enum(['http', 'stdio', 'rest']),
  name: z.string().trim().min(1, 'Der Anzeigename darf nicht leer sein.'),
  slug: z.string().regex(SLUG_RE, 'Nur a–z, 0–9 und Bindestrich, nicht am Anfang, höchstens 32 Zeichen.'),
  url: z.string(), transport: z.enum(['auto', 'streamable', 'sse']),
  authType: z.enum(['none', 'bearer', 'header']), authHeaderName: z.string(), secret: z.string(),
  command: z.string(), args: z.string(), cwd: z.string(),
  ratePerMin: posInt('Aufrufe pro Minute'), maxConcurrent: posInt('Parallel'),
  connectS: posInt('Verbinden'), listS: posInt('Liste'), callS: posInt('Aufruf'),
}).superRefine((v, ctx) => {
  const add = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  if (v.type === 'http') {
    if (!/^https?:\/\/[^/@\s]+(\/\S*)?$/.test(v.url.trim())) add('url', 'Gültige http(s)-URL ohne Zugangsdaten erforderlich.')
    if (v.authType === 'header' && !HEADER_RE.test(v.authHeaderName)) add('authHeaderName', 'Header-Name: Buchstaben, Ziffern und Bindestrich.')
  }
  if (v.type === 'stdio') {
    if (!v.command.trim()) add('command', 'Der Befehl darf nicht leer sein.')
    if (v.cwd && (v.cwd.startsWith('/') || v.cwd.split('/').includes('..'))) add('cwd', 'Relativer Pfad ohne „..“.')
  }
  for (const [k, max] of [['connectS', 600], ['listS', 600], ['callS', 600]] as const) if (v[k] > max) add(k, 'Höchstens 600 s.')
})
