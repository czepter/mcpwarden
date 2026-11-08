#!/usr/bin/env node
// mcpwarden-auth: sign in to an mcpwarden gateway from a machine without a browser (RFC 8628 device grant) and hand the
// token to MCP clients that cannot do OAuth in headless sessions, notably Claude Code via `headersHelper`.
//
//   mcpwarden-auth login   --url https://mcpwarden.example.com [--json]   sign in; prints a URL and a code to approve in any browser
//   mcpwarden-auth headers [--url ...]                                    JSON for headersHelper: {"Authorization":"Bearer ..."}
//   mcpwarden-auth token   [--url ...]                                    prints a valid access token (refreshes when needed)
//   mcpwarden-auth status  [--url ...]                                    shows who/what is stored, never the tokens
//   mcpwarden-auth logout  [--url ...]                                    removes the stored tokens (revoke the connection in the web UI too)
//
// --url may be the gateway or its /mcp URL; it defaults to $MCPWARDEN_URL, and for `headers` to $CLAUDE_CODE_MCP_SERVER_URL
// (set by Claude Code). Tokens live in $XDG_CONFIG_HOME/mcpwarden/credentials.json (mode 0600), one entry per gateway.
// No dependencies; needs Node 18+.
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CLIENT_ID = 'mcpwarden-cli'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const SKEW_MS = 60_000 // refresh a minute before expiry (access tokens live 5 minutes)

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = name => { const i = argv.indexOf(`--${name}`); return i === -1 ? undefined : (argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[i + 1]) }
const log = (...a) => console.error(...a)
const fail = (msg, code = 1) => { log(`mcpwarden-auth: ${msg}`); process.exit(code) }

const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'mcpwarden')
const credFile = join(configDir, 'credentials.json')

/** `https://host[:port][/base]` or `.../mcp` -> { origin, mcp }. */
function target(raw) {
  const v = raw || process.env.MCPWARDEN_URL || (cmd === 'headers' || cmd === 'token' ? process.env.CLAUDE_CODE_MCP_SERVER_URL : undefined)
  if (!v || v === true) fail('no gateway URL: pass --url https://your-gateway or set MCPWARDEN_URL')
  let u
  try { u = new URL(v) } catch { fail(`not a URL: ${v}`) }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) fail('the gateway URL must be https (http only for localhost)')
  const path = u.pathname.replace(/\/+$/, '')
  return { origin: u.origin, mcp: `${u.origin}${path.endsWith('/mcp') ? path : `${path}/mcp`}` }
}

async function readCreds() {
  try { return JSON.parse(await readFile(credFile, 'utf8')) } catch { return {} }
}
async function writeCreds(all) {
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  const tmp = `${credFile}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
  await chmod(tmp, 0o600)
  await rename(tmp, credFile)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
async function http(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }).catch(e => fail(`cannot reach ${new URL(url).origin}: ${e.cause?.code ?? e.message}`))
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, ok: res.ok, json, text }
}
const form = body => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body) })

/** Protected resource metadata (RFC 9728) -> authorization server metadata (RFC 8414). */
async function discover({ origin, mcp }) {
  const path = new URL(mcp).pathname
  const prm = await http(`${origin}/.well-known/oauth-protected-resource${path}`)
  if (!prm.ok || !prm.json?.authorization_servers?.[0]) fail(`${origin} does not look like an mcpwarden gateway (no protected resource metadata for ${path})`)
  const issuer = new URL(prm.json.authorization_servers[0])
  const as = await http(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, '')}`)
  if (!as.ok || !as.json?.token_endpoint) fail('authorization server metadata not available')
  if (!as.json.device_authorization_endpoint) fail('this gateway does not offer the device login (update mcpwarden)')
  return { issuer: issuer.href, tokenEndpoint: as.json.token_endpoint, deviceEndpoint: as.json.device_authorization_endpoint }
}

const entryFrom = (base, t) => ({
  ...base,
  accessToken: t.access_token,
  refreshToken: t.refresh_token ?? base.refreshToken,
  expiresAt: Date.now() + (Number(t.expires_in) || 300) * 1000,
  updatedAt: new Date().toISOString(),
})

async function login(raw) {
  const tg = target(raw)
  const meta = await discover(tg)
  const dev = await http(meta.deviceEndpoint, form({ client_id: CLIENT_ID }))
  if (!dev.ok) fail(`device login refused: ${dev.json?.error_description ?? dev.json?.error ?? dev.status}`)
  const d = dev.json
  const shown = { verification_uri: d.verification_uri, verification_uri_complete: d.verification_uri_complete, user_code: `${d.user_code.slice(0, 4)}-${d.user_code.slice(4)}`, expires_in: d.expires_in }
  if (flag('json')) console.log(JSON.stringify(shown))
  log(`\nTo sign in, open this URL in any browser and approve the request:\n\n  ${d.verification_uri_complete}\n\nOr go to ${d.verification_uri} and enter the code  ${shown.user_code}\n\nWaiting for approval (expires in ${Math.round(d.expires_in / 60)} min)...`)

  let interval = (Number(d.interval) || 5) * 1000
  const deadline = Date.now() + d.expires_in * 1000
  while (Date.now() < deadline) {
    await sleep(interval)
    const t = await http(meta.tokenEndpoint, form({ grant_type: DEVICE_GRANT, device_code: d.device_code, client_id: CLIENT_ID }))
    if (t.ok && t.json?.access_token) {
      const all = await readCreds()
      all[tg.origin] = entryFrom({ url: tg.mcp, tokenEndpoint: meta.tokenEndpoint, issuer: meta.issuer }, t.json)
      await writeCreds(all)
      log(`Signed in. Stored in ${credFile}`)
      return
    }
    const e = t.json?.error
    if (e === 'authorization_pending') continue
    if (e === 'slow_down') { interval += 5000; continue }
    if (e === 'access_denied') fail('the request was denied')
    if (e === 'expired_token') fail('the code expired before it was approved; run login again')
    fail(`login failed: ${t.json?.error_description ?? e ?? t.status}`)
  }
  fail('the code expired before it was approved; run login again')
}

/** One refresh at a time per machine: the refresh token rotates, a parallel use would invalidate it. */
async function withLock(fn) {
  const lock = `${credFile}.lock`
  await mkdir(configDir, { recursive: true, mode: 0o700 })
  for (let i = 0; i < 100; i++) {
    try {
      const h = await open(lock, 'wx')
      await h.close()
      try { return await fn() } finally { await rm(lock, { force: true }) }
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e
      const age = await stat(lock).then(s => Date.now() - s.mtimeMs).catch(() => 0)
      if (age > 30_000) await rm(lock, { force: true })
      await sleep(100)
    }
  }
  fail('could not get the credentials lock')
}

async function validToken(raw) {
  const tg = target(raw)
  let e = (await readCreds())[tg.origin]
  if (!e) fail(`not signed in to ${tg.origin}: run  mcpwarden-auth login --url ${tg.origin}`)
  if (e.expiresAt - Date.now() > SKEW_MS) return e.accessToken
  return withLock(async () => {
    e = (await readCreds())[tg.origin] // another process may have refreshed while we waited
    if (e?.expiresAt - Date.now() > SKEW_MS) return e.accessToken
    if (!e?.refreshToken) fail('no refresh token stored: run login again')
    const t = await http(e.tokenEndpoint, form({ grant_type: 'refresh_token', refresh_token: e.refreshToken, client_id: CLIENT_ID }))
    if (!t.ok || !t.json?.access_token) {
      const why = t.json?.error_description ?? t.json?.error ?? t.status
      if (t.json?.error === 'invalid_grant' || t.json?.error === 'invalid_token') fail(`the stored login is no longer valid (${why}); run  mcpwarden-auth login --url ${tg.origin}`)
      fail(`token refresh failed: ${why}`)
    }
    const all = await readCreds()
    all[tg.origin] = entryFrom(e, t.json)
    await writeCreds(all)
    return t.json.access_token
  })
}

async function main() {
  const url = flag('url')
  switch (cmd) {
    case 'login': return login(url)
    case 'token': return console.log(await validToken(url))
    case 'headers': return console.log(JSON.stringify({ Authorization: `Bearer ${await validToken(url)}` }))
    case 'status': {
      const tg = target(url)
      const e = (await readCreds())[tg.origin]
      if (!e) return console.log(`not signed in to ${tg.origin}`)
      return console.log(`signed in to ${tg.origin}\n  access token valid until ${new Date(e.expiresAt).toISOString()} (renewed automatically)\n  stored ${e.updatedAt} in ${dirname(credFile)}`)
    }
    case 'logout': {
      const tg = target(url)
      const all = await readCreds()
      if (!all[tg.origin]) return log(`not signed in to ${tg.origin}`)
      delete all[tg.origin]
      await writeCreds(all)
      return log('Removed the local tokens. Also revoke the connection under "Clients" in the mcpwarden web UI to invalidate them on the server.')
    }
    default:
      log('usage: mcpwarden-auth <login|headers|token|status|logout> [--url https://gateway] [--json]')
      process.exit(cmd ? 2 : 0)
  }
}

main().catch(e => fail(e?.message ?? String(e)))
