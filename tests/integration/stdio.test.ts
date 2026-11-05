import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startSupervisor } from '../../supervisor/main'
import { SupervisorClient, type WorkerSession } from '../../server/gateway/stdio/supervisor-client'
import { IpcTransport } from '../../server/gateway/stdio/ipc-transport'
import { ToolNotFoundError } from '../../server/gateway/ports'
import { ctxFor, makeGateway, sig } from '../helpers/gateway'
import { encryptSecret } from '../../server/gateway/crypto/secrets'
import { execFileSync } from 'node:child_process'

// Host-Lauf ohne Root: Supervisor im Modus "ohne Nutzerwechsel" (Worker unter der eigenen UID).
// UID-Wechsel, Isolation und Härtung testet container-supervisor.test.ts im Linux-Container.
let sup: Awaited<ReturnType<typeof startSupervisor>>
let client: SupervisorClient
let dataDir: string
const fake = resolve('tests/fixtures/fake-upstream/stdio.mjs')
const markDir = mkdtempSync(join(tmpdir(), 'mcpw-mark-'))
chmodSync(markDir, 0o777) // als root wechselt der Supervisor die UID, der Worker muss hier schreiben können
const mark = join(markDir, 'mark.txt')
writeFileSync(mark, '', { mode: 0o666 })
chmodSync(mark, 0o666) // Workers verschiedener Nutzer-UIDs schreiben hinein (Lauf als root mit UID-Wechsel)
const marks = () => (existsSync(mark) ? readFileSync(mark, 'utf8').trim().split('\n') : [])

beforeAll(async () => {
  execFileSync('node', ['scripts/build-supervisor.mjs'], { stdio: 'ignore' })
  dataDir = mkdtempSync(join(tmpdir(), 'mcpw-data-'))
  chmodSync(dataDir, 0o755)
  sup = await startSupervisor({ dataDir, socketPath: join(dataDir, 'sup.sock'), webUid: process.getuid!(), webGid: process.getgid!(), stdioMode: 'auto', webCmd: ['sleep', '600'], workerJs: resolve('dist/supervisor/worker.mjs'), idleUnitMs: 60_000, log: () => {} })
  client = new SupervisorClient(join(dataDir, 'sup.sock'))
})
afterAll(async () => { sup.onExit(() => {}); await sup.shutdown(0) })

const stdioGateway = () => {
  const sessions = new Map<string, WorkerSession>()
  const h = makeGateway({
    stdioTransport: async (up, creds) => {
      let s = sessions.get(up.userId)
      if (!s || s.closed) { s = await client.attach(up.userId, { maxProcs: 3, idleMin: 10 }); sessions.set(up.userId, s) }
      return new IpcTransport(s, { command: up.command!, args: up.args, env: { ...up.env, ...creds.env }, cwdRel: up.cwd ?? undefined })
    },
  })
  return { ...h, sessions }
}
const stdioUp = (h: ReturnType<typeof stdioGateway>, userId: string, over = {}) =>
  h.store.addUpstream(userId, { slug: 'fs', type: 'stdio', url: null, command: process.execPath, args: [fake], env: { FAKE_MARK: mark }, ...over })
const text = (r: { content?: unknown }) => (r.content as Array<{ text?: string }>)[0]?.text

describe('stdio upstream through supervisor + worker', () => {
  it('lazy start: no worker before first use; capabilities match the host privileges', async () => {
    expect(await client.ping()).toBe(true)
    const c = await client.capabilities()
    expect(c).toMatchObject({ ok: true, canSwitchUser: process.getuid!() === 0, workers: 0 })
  })

  it('list + call through the shared proxy path; env secret reaches the child, MASTER_KEY & co. do not', async () => {
    const h = stdioGateway()
    const up = stdioUp(h, 'u-env', { authType: 'env' })
    h.store.secrets.push({ userId: 'u-env', upstreamId: up.id, kind: 'env', name: 'API_TOKEN', ciphertext: encryptSecret(h.masterKey, 'u-env', { upstreamId: up.id, kind: 'env', name: 'API_TOKEN' }, 'tok-123') })
    process.env.MASTER_KEY = 'must-not-leak'
    const ctx = ctxFor('u-env')
    expect((await h.gw.toolSource.listTools(ctx)).map(t => t.name)).toEqual(expect.arrayContaining(['fs__echo', 'fs__env']))
    expect(text(await h.gw.toolSource.callTool(ctx, 'fs__echo', { text: 'hi' }, { signal: sig() }))).toBe('hi')
    const env = JSON.parse(text(await h.gw.toolSource.callTool(ctx, 'fs__env', {}, { signal: sig() }))!)
    expect(env.API_TOKEN).toBe('tok-123')
    for (const k of ['MASTER_KEY', 'BETTER_AUTH_SECRET', 'DATABASE_URL']) expect(env[k]).toBeUndefined()
    expect(Object.keys(env).sort()).toEqual(expect.arrayContaining(['API_TOKEN', 'FAKE_MARK', 'HOME', 'PATH', 'TMPDIR']))
    expect(env.HOME).toContain(`${dataDir}/stdio/`)
    expect((await client.capabilities()).workers).toBeGreaterThanOrEqual(1)
    delete process.env.MASTER_KEY
    await h.gw.shutdown(300)
  })

  it('client abort -> notifications/cancelled reaches the stdio server (legacy/stdio era)', async () => {
    const h = stdioGateway()
    stdioUp(h, 'u-cancel')
    const ctx = ctxFor('u-cancel')
    await h.gw.toolSource.listTools(ctx)
    const ac = new AbortController()
    const p = h.gw.toolSource.callTool(ctx, 'fs__hang', {}, { signal: ac.signal })
    await new Promise(r => setTimeout(r, 600))
    ac.abort()
    expect((await p).isError).toBe(true)
    await new Promise(r => setTimeout(r, 600))
    expect(marks()).toContain('hang-cancelled')
    await h.gw.shutdown(300)
  })

  it('call timeout on stdio: no second call of a non-idempotent tool', async () => {
    const h = stdioGateway()
    stdioUp(h, 'u-order', { timeouts: { callMs: 400 } })
    const ctx = ctxFor('u-order')
    await h.gw.toolSource.listTools(ctx)
    const before = marks().filter(m => m === 'create_order').length
    await h.gw.toolSource.callTool(ctx, 'fs__create_order', {}, { signal: sig() })
    await new Promise(r => setTimeout(r, 400))
    expect(marks().filter(m => m === 'create_order').length - before).toBe(1)
    await h.gw.shutdown(300)
  })

  it('child dies mid-call: clear error, next call starts a fresh child', async () => {
    const h = stdioGateway()
    const up = stdioUp(h, 'u-die', { ratePerMin: 1000 })
    const ctx = ctxFor('u-die')
    await h.gw.toolSource.listTools(ctx)
    const r = await h.gw.toolSource.callTool(ctx, 'fs__die', {}, { signal: sig() })
    expect(r.isError).toBe(true)
    await new Promise(r => setTimeout(r, 200))
    const ok = await h.gw.toolSource.callTool(ctx, 'fs__echo', { text: 'again' }, { signal: sig() })
    expect(text(ok)).toBe('again')
    void up
    await h.gw.shutdown(300)
  })

  it('child limit per user (maxProcs 3): the 4th concurrent child is refused', async () => {
    const s = await client.attach('u-limit', { maxProcs: 3 })
    const ts = [] as IpcTransport[]
    for (let i = 0; i < 3; i++) { const t = new IpcTransport(s, { command: 'sleep', args: ['30'], env: {} }); await t.start(); ts.push(t) }
    const t4 = new IpcTransport(s, { command: 'sleep', args: ['30'], env: {} })
    await expect(t4.start()).rejects.toMatchObject({ code: 'limit' })
    for (const t of ts) await t.close()
    s.close()
  })

  it('stopWorker ends the data connection (EOF) and the next attach works', async () => {
    const s = await client.attach('u-stop')
    let closed = false
    s.onClose(() => { closed = true })
    await client.stopWorker('u-stop')
    await new Promise(r => setTimeout(r, 300))
    expect(closed).toBe(true)
    const s2 = await client.attach('u-stop')
    s2.close()
  })

  it('worker shutdown never kills unrelated processes of the supervisor/web UID (H1: no kill(-1) without isolation)', async () => {
    const { spawn } = await import('node:child_process')
    const bystander = spawn('sleep', ['600'], { stdio: 'ignore' })
    try {
      const s = await client.attach('u-h1')
      const t = new IpcTransport(s, { command: 'sleep', args: ['30'], env: {} })
      await t.start()
      await client.stopWorker('u-h1')
      await new Promise(r => setTimeout(r, 1200))
      expect(() => process.kill(bystander.pid!, 0)).not.toThrow()
      expect(() => process.kill(process.pid, 0)).not.toThrow()
      expect(await client.ping()).toBe(true)
    } finally { bystander.kill('SIGKILL') }
  })

  it('purge failure does not kill the supervisor: error reply, supervisor keeps serving (H3)', async () => {
    const s = await client.attach('u-purgefail')
    await client.stopWorker('u-purgefail')
    s.close()
    const { readdirSync, rmSync, writeFileSync } = await import('node:fs')
    const uidDir = readdirSync(join(dataDir, 'stdio')).filter(n => /^\d+$/.test(n)).map(n => join(dataDir, 'stdio', n))
    const mine = uidDir.sort().pop()!
    rmSync(mine, { recursive: true, force: true })
    writeFileSync(mine, 'not a directory anymore')
    // lstat sieht eine Datei; der Befehl muss mit purge_failed antworten statt den Supervisor zu beenden
    await expect(client.stopWorker('u-purgefail', true)).rejects.toMatchObject({ code: 'purge_failed' })
    expect(await client.ping()).toBe(true)
  })

  it('concurrent attach for the same user starts exactly one worker (M6)', async () => {
    const results = await Promise.allSettled([client.attach('u-race'), client.attach('u-race'), client.attach('u-race')])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(r => r.status === 'rejected').every(r => (r as PromiseRejectedResult).reason.code === 'busy')).toBe(true)
    for (const r of results) if (r.status === 'fulfilled') r.value.close()
    await client.stopWorker('u-race')
  })

  it('unknown/other user cannot reach this user\'s tools', async () => {
    const h = stdioGateway()
    stdioUp(h, 'u-a')
    await expect(h.gw.toolSource.callTool(ctxFor('u-b'), 'fs__echo', { text: 'x' }, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
    await h.gw.shutdown(300)
  })
})
