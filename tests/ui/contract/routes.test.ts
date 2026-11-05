import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LinkInfo, StatsSummary, StdioDraft } from '#shared/api-types'
import { schemas as baseSchemas } from '../../contract/schemas'
import { makeServer } from '../../../mocks/node'
import { getState, resetState } from '../../../mocks/state'

// Strikte Schemas (strictObject): fehlende UND unbekannte Felder in Mock-Antworten fallen auf.
// `satisfies z.ZodType<T>` bindet jedes Schema an den Vertragstyp in shared/api-types.ts; Backend-Tests koennen dieselben Schemas nutzen.
const BASE = process.env.CONTRACT_BASE_URL ?? 'http://localhost:3000'
const { string: str, number: num } = z

// Phase-2-Routen (Statistik, Auth-Links, stdio-Entwurf): es gibt kein Backend, nur die Mocks; die uebrigen Schemas kommen aus tests/contract/schemas.ts.
const phase2 = {
  draft: z.strictObject({ id: str(), slug: str(), command: str(), args: z.array(str()), cwd: str(), envNames: z.array(str()), createdVia: z.strictObject({ client: str(), at: str() }) }) satisfies z.ZodType<StdioDraft>,
  stats: z.strictObject({
    window: z.enum(['5m', '1h', '24h', '7d']), calls: num(), callsPerMin: num(), okRate: num(), peakConcurrent: num(), activeClients: num(),
    perHour: z.array(z.strictObject({ t: str(), calls: num() })),
    outcomes: z.array(z.strictObject({ outcome: z.enum(['ok', 'tool_error', 'timeout', 'upstream_error', 'rate_limited', 'breaker_open', 'denied']), count: num() })),
    rows: z.array(z.strictObject({ upstream: str(), calls: num(), okRate: num(), p5Ms: num(), p50Ms: num(), p75Ms: num(), p95Ms: num(), p99Ms: num(), overheadP95Ms: num() })),
  }) satisfies z.ZodType<StatsSummary>,
  link: z.union([
    z.strictObject({ state: z.literal('open'), kind: z.enum(['token', 'header', 'oauth']), upstream: z.strictObject({ slug: str(), url: str() }), headerName: str().optional(), expiresAt: str() }),
    z.strictObject({ state: z.enum(['expired', 'used', 'forbidden']) }),
  ]) satisfies z.ZodType<LinkInfo>,
}
const schemas = { ...baseSchemas, ...phase2 }

const server = makeServer('all')
beforeAll(() => { (globalThis as { __mockNoDelay?: boolean }).__mockNoDelay = true; server.listen({ onUnhandledFrame: 'error' }) })
afterAll(() => server.close())
beforeEach(() => { resetState(); getState().signedIn = true })

const get = (path: string) => fetch(`${BASE}${path}`)
const post = (path: string, body?: unknown) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

describe('alle GET-Routen: strikte Vertrags-Schemas', () => {
  const cases: Array<[string, string, keyof typeof schemas]> = [
    ['Sitzung', '/api/auth/get-session', 'session'],
    ['Upstream-Liste', '/api/upstreams', 'upstreamList'],
    ['Upstream-Detail', '/api/upstreams/up_1', 'upstreamDetail'],
    ['Tools', '/api/upstreams/up_1/tools', 'tools'],
    ['stdio-Entwurf', '/api/upstreams/up_1/draft', 'draft'],
    ['Tokens', '/api/me/pats', 'pats'],
    ['Verbindungen', '/api/me/connections', 'connections'],
    ['Nutzer', '/api/admin/users', 'users'],
    ['Einladungen', '/api/admin/invites', 'invites'],
    ['Einladung gueltig', '/api/invites/gueltig-token', 'inviteCheck'],
    ['Einladung abgelaufen', '/api/invites/abgelaufen-token', 'inviteCheck'],
    ['Instanz-Einstellungen', '/api/admin/settings', 'settings'],
    ['DCR-Richtlinie', '/api/admin/oauth/policy', 'policy'],
    ['Allowlist', '/api/admin/oauth/allowlist', 'allowlist'],
    ['OAuth-Clients', '/api/admin/oauth/clients', 'oauthClients'],
    ['Consent (unbekannt)', '/api/oauth/consent-info?client_id=agent-x&sig=ok', 'consent'],
    ['Consent (bekannt)', '/api/oauth/consent-info?client_id=claude-code&sig=ok', 'consent'],
    ['Statistik', '/api/stats/summary?window=24h', 'stats'],
    ['Link offen', '/api/links/abc', 'link'],
    ['Link abgelaufen', '/api/links/abgelaufen', 'link'],
    ['Audit', '/api/audit', 'audit'],
    ['Public-Config', '/api/public-config', 'publicConfig'],
    ['Capabilities', '/api/me/capabilities', 'capabilities'],
    ['Dashboard', '/api/dashboard', 'dashboard'],
    ['Persoenliche Einstellungen', '/api/me/settings', 'meSettings'],
  ]
  for (const [name, path, key] of cases) {
    it(name, async () => {
      const r = await get(path)
      expect(r.status).toBe(200)
      const res = schemas[key].safeParse(await r.json())
      expect(res.success ? [] : res.error.issues, `${path}`).toEqual([])
    })
  }
  it('Test-Antwort (ok und Fehler)', async () => {
    const ok = await post('/api/upstreams/up_1/test')
    expect(schemas.testResult.safeParse(await ok.json()).success).toBe(true)
  })
})

describe('Mail-Benachrichtigungen: Einstellung und Einladungsversand', () => {
  const patch = (path: string, body: unknown) => fetch(`${BASE}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  it('Standard an; PATCH schaltet um und bleibt; Antwort entspricht dem Vertrag', async () => {
    expect(await (await get('/api/me/settings')).json()).toEqual({ notifyStatusMail: true })
    const r = await patch('/api/me/settings', { notifyStatusMail: false })
    expect(r.status).toBe(200)
    expect(schemas.meSettings.parse(await r.json())).toEqual({ notifyStatusMail: false })
    expect(await (await get('/api/me/settings')).json()).toEqual({ notifyStatusMail: false })
  })
  it('PATCH validiert wie das Backend: Nicht-Boolean und unbekannte Felder sind 422', async () => {
    const bad = await patch('/api/me/settings', { notifyStatusMail: 'nein' })
    expect(bad.status).toBe(422)
    expect(((await bad.json()) as { data: { field?: string } }).data.field).toBe('notifyStatusMail')
    expect((await patch('/api/me/settings', { role: 'admin' })).status).toBe(422)
  })
  it('Einladung mit sendMail: mailQueued; ohne Adresse oder ohne Mailer 422', async () => {
    const ok = await post('/api/admin/invites', { email: 'neu@example.test', sendMail: true })
    expect(ok.status).toBe(201)
    expect(schemas.inviteCreated.parse(await ok.json()).mailQueued).toBe(true)
    const noAddr = await post('/api/admin/invites', { sendMail: true })
    expect(noAddr.status).toBe(422)
    expect(((await noAddr.json()) as { data: { field?: string } }).data.field).toBe('sendMail')
    localStorage.setItem('mockMail', 'off')
    try { expect((await post('/api/admin/invites', { email: 'neu@example.test', sendMail: true })).status).toBe(422) } finally { localStorage.removeItem('mockMail') }
  })
})

describe('Fehler und Rollen wie das Backend', () => {
  it('Admin-Routen: Nutzer bekommt 403 mit ApiErrorBody', async () => {
    localStorage.setItem('mockRole', 'user')
    for (const p of ['/api/admin/users', '/api/admin/invites', '/api/admin/settings', '/api/admin/oauth/policy', '/api/admin/oauth/clients']) {
      const r = await get(p)
      expect(r.status, p).toBe(403)
      z.strictObject({ statusCode: z.literal(403), statusMessage: str(), data: z.looseObject({ code: z.literal('forbidden'), message: str() }) }).parse(await r.json())
    }
  })
  it('Registrierung: Passwort unter 12 Zeichen wird serverseitig abgelehnt', async () => {
    const r = await fetch(`${BASE}/api/auth/sign-up/email`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-invite-token': 'gueltig-token' }, body: JSON.stringify({ name: 'N', email: 'n@example.test', password: 'kurz' }) })
    expect(r.status).toBe(422)
    expect(((await r.json()) as { data: { field?: string } }).data.field).toBe('password')
  })
})
