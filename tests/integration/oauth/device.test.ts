// RFC 8628 device grant for headless sessions: protocol, the mcpwarden rules around it (first-party client only,
// required scopes, consent + revocation, ownership of the user code) and the real /mcp access with the issued tokens.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectionList } from '#shared/api-types'
import { api, createInstance, createUser, signUpFirstAdmin, startServer, type ApiClient, type TestInstance, type TestServer } from '../harness'
import { decodeJwt, registerClient } from '../../helpers/oauth-client'

const CLIENT = 'mcpwarden-cli'
const GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

let inst: TestInstance
let srv: TestServer
let admin: ApiClient
let userB: ApiClient

const tick = (ms: number) => new Promise(r => setTimeout(r, ms))
const form = (body: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '198.51.100.20' }, body: new URLSearchParams(body) })

async function json(res: Response) {
  const text = await res.text()
  try { return { status: res.status, json: JSON.parse(text) as any, text } } catch { return { status: res.status, json: undefined as any, text } } // eslint-disable-line @typescript-eslint/no-explicit-any
}

const requestCode = (clientId = CLIENT, extra: Record<string, string> = {}) =>
  fetch(`${srv.url}/api/auth/device/code`, form({ client_id: clientId, ...extra })).then(json)
const poll = (deviceCode: string, clientId = CLIENT) =>
  fetch(`${srv.url}/api/auth/oauth2/token`, form({ grant_type: GRANT, device_code: deviceCode, client_id: clientId })).then(json)
const mcp = (token: string) => fetch(`${srv.url}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream', 'authorization': `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
})

/** The browser side: open the verification page (claims the code), then approve or deny. */
async function review(user: ApiClient, userCode: string, decision: 'approve' | 'deny' = 'approve') {
  const claim = await user.request(`/api/auth/device?user_code=${userCode}`)
  const r = await user.request(`/api/auth/device/${decision}`, { body: { userCode } })
  return { claim, r }
}

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  admin = await signUpFirstAdmin(srv)
  await createUser(admin, { name: 'B', email: 'b@example.com', password: 'password-b-12345' })
  userB = api(srv.url)
  expect((await userB.request('/api/auth/sign-in/email', { body: { email: 'b@example.com', password: 'password-b-12345' } })).status).toBe(200)
})
afterAll(async () => {
  await srv.stop()
  await inst.cleanup()
})

describe('discovery and request', () => {
  it('advertises the endpoint and the grant in the AS metadata', async () => {
    const as = await (await fetch(`${srv.url}/.well-known/oauth-authorization-server/api/auth`)).json()
    expect(as.device_authorization_endpoint).toBe(`${srv.url}/api/auth/device/code`)
    expect(as.grant_types_supported).toContain(GRANT)
  })

  it('issues codes; the verification URI is the UI page, not the API endpoint', async () => {
    const r = await requestCode()
    expect(r.status, r.text).toBe(200)
    expect(r.json).toMatchObject({ verification_uri: `${srv.url}/device`, expires_in: 600, interval: 5 })
    expect(r.json.user_code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(new URL(r.json.verification_uri_complete).searchParams.get('user_code')).toBe(r.json.user_code)
  })

  it('works with a JSON body as well', async () => {
    const res = await fetch(`${srv.url}/api/auth/device/code`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.21' }, body: JSON.stringify({ client_id: CLIENT }) })
    expect(res.status).toBe(200)
  })

  it('first-party client only: unknown client, DCR client and a DCR registration with the grant are refused', async () => {
    expect((await requestCode('nope')).status).toBe(400)
    const reg = await registerClient(srv.url, { client_name: 'mcpwarden CLI' })
    expect(reg.status).toBe(201)
    const dcr = await requestCode(reg.json.client_id)
    expect(dcr.status, dcr.text).toBe(400)
    expect(dcr.json.error).toMatch(/unauthorized_client|invalid_client/)
    const withGrant = await registerClient(srv.url, { grant_types: [GRANT, 'refresh_token'] })
    expect(withGrant.status).toBe(400)
    expect(withGrant.json.error).toBe('invalid_client_metadata')
  })
})

describe('approval and token', () => {
  it('pending -> approve -> token set; /mcp accepts it; revoking the connection kills it', async () => {
    const c = await requestCode()
    const dc = c.json.device_code as string
    const pending = await poll(dc)
    expect(pending.status).toBe(400)
    expect(pending.json.error).toBe('authorization_pending')
    expect((await poll(dc)).json.error).toBe('slow_down') // polled again before the 5 s interval

    const { claim, r } = await review(admin, c.json.user_code)
    expect(claim.status).toBe(200)
    expect(claim.json).toMatchObject({ status: 'pending', client_id: CLIENT })
    expect(r.status, r.text).toBe(200)

    await tick(5200)
    const tok = await poll(dc)
    expect(tok.status, tok.text).toBe(200)
    expect(tok.json.token_type).toBe('Bearer')
    expect(tok.json.refresh_token).toBeTruthy()
    const claims = decodeJwt(tok.json.access_token)
    expect(claims.aud).toContain(`${srv.url}/mcp`)
    expect(String(claims.scope).split(' ').sort()).toEqual(['mcp:tools', 'offline_access', 'openid'])

    expect((await mcp(tok.json.access_token)).status).toBe(200)

    // a device code is consumed exactly once
    await tick(5200)
    expect((await poll(dc)).json.error).toBe('invalid_grant')

    // refresh works and keeps the access
    const refreshed = await fetch(`${srv.url}/api/auth/oauth2/token`, form({ grant_type: 'refresh_token', refresh_token: tok.json.refresh_token, client_id: CLIENT })).then(json)
    expect(refreshed.status, refreshed.text).toBe(200)
    expect((await mcp(refreshed.json.access_token)).status).toBe(200)

    // it shows up as a connection of the user and can be revoked there
    const list = (await admin.request('/api/me/connections')).json as ConnectionList
    const conn = list.items.find(i => i.clientId === CLIENT)
    expect(conn).toMatchObject({ name: 'mcpwarden CLI', redirectHost: '' })
    expect((await admin.request(`/api/me/connections/${CLIENT}`, { method: 'DELETE' })).status).toBe(204)
    expect((await mcp(refreshed.json.access_token)).status).toBe(401)
    const afterRevoke = await fetch(`${srv.url}/api/auth/oauth2/token`, form({ grant_type: 'refresh_token', refresh_token: refreshed.json.refresh_token, client_id: CLIENT })).then(json)
    expect(afterRevoke.status).toBe(400)
  })

  it('deny ends with access_denied and issues nothing', async () => {
    const c = await requestCode()
    const { r } = await review(admin, c.json.user_code, 'deny')
    expect(r.status).toBe(200)
    await tick(5200)
    const tok = await poll(c.json.device_code)
    expect(tok.status).toBe(400)
    expect(tok.json.error).toBe('access_denied')
  })

  it('a code claimed by one user cannot be approved by another; anonymous approval is refused', async () => {
    const c = await requestCode()
    expect((await admin.request(`/api/auth/device?user_code=${c.json.user_code}`)).status).toBe(200)
    const other = await userB.request(`/api/auth/device?user_code=${c.json.user_code}`)
    expect(other.json).toEqual({ user_code: c.json.user_code, status: 'pending' }) // no client/scope leak
    expect((await userB.request('/api/auth/device/approve', { body: { userCode: c.json.user_code } })).status).toBe(403)
    expect((await api(srv.url).request('/api/auth/device/approve', { body: { userCode: c.json.user_code } })).status).toBe(401)
    await tick(5200)
    expect((await poll(c.json.device_code)).json.error).toBe('authorization_pending')
  })

  it('a disabled client cannot start the flow (admin kill switch)', async () => {
    const off = await admin.request(`/api/admin/oauth/clients/${CLIENT}`, { method: 'PATCH', body: { disabled: true } })
    expect(off.status, off.text).toBe(200)
    expect((await requestCode()).status).toBe(400)
    expect((await admin.request(`/api/admin/oauth/clients/${CLIENT}`, { method: 'PATCH', body: { disabled: false } })).status).toBe(200)
    expect((await requestCode()).status).toBe(200)
  })
})

describe('tools/mcpwarden-auth.mjs (the headless helper)', () => {
  const CLI = fileURLToPath(new URL('../../../tools/mcpwarden-auth.mjs', import.meta.url))
  let home: string
  const run = (args: string[], onStdout?: (chunk: string) => void) => new Promise<{ code: number | null, stdout: string, stderr: string }>((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, XDG_CONFIG_HOME: home, MCPWARDEN_URL: '' } })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => { stdout += d; onStdout?.(stdout) })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('close', code => resolve({ code, stdout, stderr }))
  })
  beforeAll(async () => { home = await mkdtemp(join(tmpdir(), 'mcpw-cli-')) })
  afterAll(async () => { await rm(home, { recursive: true, force: true }) })

  it('refuses without a login, signs in through the approval, serves headers, refreshes, logs out', async () => {
    const before = await run(['headers', '--url', srv.url])
    expect(before.code).toBe(1)
    expect(before.stderr).toContain('not signed in')

    let approved = false
    const login = await run(['login', '--url', srv.url, '--json'], (out) => {
      const line = out.split('\n')[0]
      if (approved || !line?.endsWith('}')) return
      approved = true
      const { user_code: code } = JSON.parse(line) as { user_code: string }
      void review(admin, code.replace('-', ''))
    })
    expect(login.code, login.stderr).toBe(0)
    expect(login.stderr).toContain('Signed in')

    const h1 = await run(['headers', '--url', srv.url])
    expect(h1.code, h1.stderr).toBe(0)
    const token1 = (JSON.parse(h1.stdout) as { Authorization: string }).Authorization.replace('Bearer ', '')
    expect((await mcp(token1)).status).toBe(200)

    // Expire the stored access token: the helper must refresh (and rotate) on its own.
    const file = join(home, 'mcpwarden', 'credentials.json')
    const creds = JSON.parse(await readFile(file, 'utf8'))
    creds[srv.url].expiresAt = 0
    await writeFile(file, JSON.stringify(creds))
    const h2 = await run(['headers', '--url', srv.url])
    expect(h2.code, h2.stderr).toBe(0)
    const token2 = (JSON.parse(h2.stdout) as { Authorization: string }).Authorization.replace('Bearer ', '')
    expect(token2).not.toBe(token1)
    expect((await mcp(token2)).status).toBe(200)
    expect((await run(['status', '--url', srv.url])).stdout).toContain('signed in')
    expect((await readFile(file, 'utf8')).includes(token2)).toBe(true)

    expect((await run(['logout', '--url', srv.url])).code).toBe(0)
    expect((await run(['headers', '--url', srv.url])).code).toBe(1)
  }, 60_000)
})
