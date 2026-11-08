// Theme, the two extra mail switches, "new client connected" mail and account self-deletion against the real server.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuditList, MeSettings, PatCreated } from '#shared/api-types'
import { readable, startFakeSmtp, type FakeSmtp } from '../helpers/fake-smtp'
import { fullFlow } from '../helpers/oauth-client'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from './harness'

const PW = 'password-b-12345'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function until<T>(fn: () => T | undefined, ms = 8000): Promise<T> {
  const end = Date.now() + ms
  while (Date.now() < end) { const v = fn(); if (v !== undefined) return v; await sleep(50) }
  throw new Error('timeout')
}

let inst: TestInstance
let srv: TestServer
let smtp: FakeSmtp
let admin: ApiClient
let b: ApiClient

async function login(email: string, password: string, ip: string) {
  const c = api(srv.url, ip)
  const r = await c.request('/api/auth/sign-in/email', { body: { email, password } })
  return { c, status: r.status }
}
const newClientMails = (to: string) => smtp.mails.filter(m => m.to.includes(to) && /Neuer Client verbunden/.test(readable(m)))

beforeAll(async () => {
  inst = await createInstance()
  smtp = await startFakeSmtp()
  srv = await startServer(inst, { env: { SMTP_URL: `smtp://127.0.0.1:${smtp.port}`, MAIL_FROM: 'mcpwarden <noreply@example.com>' } })
  admin = await signUpFirstAdmin(srv)
  await createUser(admin, { name: 'B', email: 'b@example.com', password: PW })
  b = (await login('b@example.com', PW, '198.51.100.31')).c
})
afterAll(async () => {
  await srv.stop()
  await smtp.close()
  await inst.cleanup()
})

describe('settings: theme and mail switches', () => {
  it('defaults, round trip and persistence per user', async () => {
    const d = (await b.request('/api/me/settings')).json as MeSettings
    expect(d).toMatchObject({ notifyStatusMail: true, notifyNewClient: true, notifyWeekly: false, theme: 'system' })
    const r = await b.request('/api/me/settings', { method: 'PATCH', body: { theme: 'dark', notifyWeekly: true, notifyNewClient: false } })
    expect(r.status, r.text).toBe(200)
    expect(r.json).toMatchObject({ theme: 'dark', notifyWeekly: true, notifyNewClient: false, notifyStatusMail: true })
    expect(((await b.request('/api/me/settings')).json as MeSettings).theme).toBe('dark')
    // other users are unaffected
    expect(((await admin.request('/api/me/settings')).json as MeSettings)).toMatchObject({ theme: 'system', notifyWeekly: false })
    // survives a new session
    const again = (await login('b@example.com', PW, '198.51.100.32')).c
    expect(((await again.request('/api/me/settings')).json as MeSettings).theme).toBe('dark')
  })
  it('validates input', async () => {
    expect((await b.request('/api/me/settings', { method: 'PATCH', body: { theme: 'neon' } })).status).toBe(422)
    expect((await b.request('/api/me/settings', { method: 'PATCH', body: { notifyWeekly: 'yes' } })).status).toBe(422)
    expect((await b.request('/api/me/settings', { method: 'PATCH', body: { other: 1 } })).status).toBe(422)
    expect(((await b.request('/api/me/settings')).json as MeSettings).theme).toBe('dark')
  })
})

describe('mail "new client connected"', () => {
  it('goes to the owner once per client on the first use, and not with the switch off', async () => {
    const mcp = (token: string) => fetch(`${srv.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', 'authorization': `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })
    // admin has the switch on (default)
    const f = await fullFlow(admin, srv.url, { meta: { client_name: 'Test Client <b>X</b>' } })
    expect(f.tok.status, f.tok.text).toBe(200)
    expect((await mcp(f.tok.json.access_token)).status).toBe(200)
    const mail = await until(() => newClientMails('admin@example.com')[0])
    expect(readable(mail)).not.toContain('<b>X</b>')
    await mcp(f.tok.json.access_token)
    await sleep(500)
    expect(newClientMails('admin@example.com')).toHaveLength(1) // second use: no new mail
    // user B switched it off above
    const g = await fullFlow(b, srv.url)
    expect((await mcp(g.tok.json.access_token)).status).toBe(200)
    await sleep(800)
    expect(newClientMails('b@example.com')).toHaveLength(0)
  })
})

describe('account self-deletion', () => {
  it('wrong confirmation or password changes nothing; the last admin is refused', async () => {
    const wrongMail = await b.request('/api/me', { method: 'DELETE', body: { password: PW, confirmEmail: 'other@example.com' } })
    expect(wrongMail.status).toBe(422)
    const wrongPw = await b.request('/api/me', { method: 'DELETE', body: { password: 'not-the-password', confirmEmail: 'b@example.com' } })
    expect(wrongPw.status).toBe(403)
    expect((wrongPw.json as { data?: { code?: string } }).data?.code ?? (wrongPw.json as { code?: string }).code).toBe('invalid_password')
    expect((await b.request('/api/me/settings')).status).toBe(200) // session still valid, account still there
    const last = await admin.request('/api/me', { method: 'DELETE', body: { password: 'admin-password-123', confirmEmail: 'admin@example.com' } })
    expect(last.status, last.text).toBe(409)
    expect((await admin.request('/api/me/settings')).status).toBe(200)
  })
  it('removes the account with its data, tokens and sessions; leaves only an anonymous audit entry', async () => {
    const pat = (await b.request('/api/me/pats', { body: { name: 'cli', expiresInDays: 30 } })).json as PatCreated
    const mcpPat = () => fetch(`${srv.url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', 'authorization': `Bearer ${pat.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })
    expect((await mcpPat()).status).toBe(200)
    expect(((await admin.request('/api/admin/users')).json as { items: Array<{ email: string }> }).items.map(u => u.email)).toContain('b@example.com')

    const r = await b.request('/api/me', { method: 'DELETE', body: { password: PW, confirmEmail: ' B@example.com ' } })
    expect(r.status, r.text).toBe(204)

    expect((await b.request('/api/me/settings')).status).toBe(401) // session gone
    expect((await login('b@example.com', PW, '198.51.100.33')).status).not.toBe(200)
    expect((await mcpPat()).status).toBe(401) // token gone
    expect(((await admin.request('/api/admin/users')).json as { items: Array<{ email: string }> }).items.map(u => u.email)).not.toContain('b@example.com')
    const audit = (await admin.request('/api/audit')).json as AuditList
    const entry = audit.items.find(i => i.action === 'user.self_delete')
    expect(entry).toBeTruthy()
    expect(JSON.stringify(entry)).not.toContain('b@example.com')
  })
})
