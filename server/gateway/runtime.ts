/**
 * Verdrahtung der Gateway-Funktionen mit Datenbank, Einstellungen und Supervisor (Plan Aufgabe 1.2/1.4).
 * Ein Runtime-Objekt je Prozess (globalThis, überlebt Dev-HMR); `closeRuntime` ist der Shutdown-Pfad.
 */
import { AllowList } from './net/ssrf'
import { createGateway, type Gateway } from './index'
import { SHUTDOWN_DRAIN_MS, STATS } from './config'
import { IpcTransport } from './stdio/ipc-transport'
import { SessionCache } from './stdio/session-cache'
import { SupervisorClient, type WorkerSession } from './stdio/supervisor-client'
import { stdioPolicy, type StdioReason } from './stdio/policy'
import { GatewayRepo } from './upstream/repo'
import type { UpstreamRow } from './upstream/types'
import { getDb } from '../db'
import { getMasterKey } from '../utils/master-key'
import { audit } from '../utils/audit'
import { getMailer } from '../mail'
import { createStatusNotifier } from '../mail/notify'
import { getConfig } from '../utils/config'
import { notifyToolsChanged } from '../mcp/notify'
import { registerGatewayLifecycle } from './lifecycle'
import { registerLifecycleHandler } from '../utils/user-lifecycle'
import { revokeOAuthGrantsOfUser, revokePatsOfUser } from '../auth/pat-store'

export type Runtime = {
  repo: GatewayRepo
  gw: Gateway
  supervisor: SupervisorClient | null
  imageTarget: 'slim' | 'full'
  allow: () => Promise<AllowList>
  invalidateSettings: () => void
  draining: boolean
  stdioPolicyFor: (role: 'admin' | 'user', stdioAllowed: boolean) => Promise<{ allowed: true } | { allowed: false, reason: StdioReason }>
}

const g = globalThis as typeof globalThis & { __mcpwRuntime?: Promise<Runtime>, __mcpwRuntimeStop?: () => Promise<void>, __mcpwStatsDropped?: () => number }
const SETTINGS_TTL_MS = 10_000

async function create(): Promise<Runtime> {
  const db = await getDb()
  const repo = new GatewayRepo(db)
  const log = (m: string, err?: unknown) => console.error(`[mcpwarden] ${m}`, err instanceof Error ? err.message : '')

  // Einstellungen: kurzer Cache (<= 10 s), damit `ssrf.allow` zeitnah, aber nicht pro Request gelesen wird
  let cache: { at: number, allow: AllowList, stdio: boolean } | null = null
  const settings = async () => {
    if (cache && Date.now() - cache.at < SETTINGS_TTL_MS) return cache
    const entries = await repo.getSetting<string[]>('ssrf.allow', [])
    const { list, invalid } = AllowList.lenient(entries)
    if (invalid.length) log(`ssrf.allow: ${invalid.length} ungültige Einträge werden ignoriert`)
    return (cache = { at: Date.now(), allow: list, stdio: await repo.getSetting<boolean>('stdio.enabled', false) })
  }

  const imageTarget = process.env.IMAGE_TARGET === 'full' ? 'full' : 'slim'
  const stdioMode = process.env.STDIO_MODE === 'off' ? 'off' : 'auto'
  const supervisor = imageTarget === 'full' && stdioMode !== 'off' ? new SupervisorClient(process.env.SUP_SOCKET ?? '/run/mcpwarden/sup.sock') : null
  const sessions = new SessionCache<WorkerSession>()

  const cfg = getConfig()
  // Statusmails (nur mit aktivem Mailer): Fire-and-forget, gedrosselt je (Upstream, Zustand), Opt-out je Nutzer
  const statusMail = createStatusNotifier({
    mailer: getMailer(),
    baseUrl: cfg.baseUrl,
    windowMs: cfg.statusMailWindowMin * 60_000,
    log: m => console.error(m),
    lookup: async (userId, upstreamId) => {
      const [owner, up] = await Promise.all([repo.getUserLite(userId), repo.getUpstream(userId, upstreamId)])
      if (!owner || owner.banned || !up) return null
      return { email: owner.email, name: up.name, notify: await repo.getNotifyStatusMail(userId) }
    },
  })

  const rtRef = {} as Runtime
  const gw = createGateway({
    store: repo,
    masterKey: getMasterKey(),
    getAllow: async () => (await settings()).allow,
    statsWrite: rows => repo.writeStats(rows),
    notifyChanged: notifyToolsChanged,
    log,
    statusSink: {
      onChange: async (id, userId, s, prev) => {
        await repo.persistStatus(userId, id, s)
        const attention = (x: string) => x === 'open' || x === 'auth_expired'
        if (attention(s.status) || (attention(prev) && s.status === 'healthy')) {
          await audit(repo, { userId, actor: 'system', action: 'upstream.status', targetType: 'upstream', targetId: id, meta: { status: s.status, previous: prev } }, log)
          statusMail.notify({ upstreamId: id, userId, status: s.status, previous: prev, reason: s.reason })
        }
      },
    },
    stdioTransport: supervisor
      ? async (up: UpstreamRow, creds) => {
        const limits = await repo.getLimits(up.userId)
        // Bei jedem Verbindungsaufbau erneut: Entzug der Freigabe wirkt sofort (Rolle und Limits frisch aus der DB)
        const owner = await repo.getUserLite(up.userId)
        const pol = await rtRef.stdioPolicyFor(owner?.role === 'admin' ? 'admin' : 'user', limits.stdioAllowed)
        if (!pol.allowed) throw Object.assign(new Error(`stdio not allowed (${pol.reason})`), { code: 'stdio_not_allowed' })
        // Gleichzeitige Erstverbindungen teilen sich einen attach (der Supervisor liefert dem zweiten sonst `busy`)
        const s = await sessions.get(up.userId, () => supervisor.attach(up.userId, { maxProcs: limits.stdioMaxProcs, idleMin: limits.stdioIdleMin }))
        return new IpcTransport(s, { command: up.command!, args: up.args, env: { ...up.env, ...creds.env }, cwdRel: up.cwd ?? undefined })
      }
      : undefined,
  })
  registerGatewayLifecycle(gw, { stopWorker: async (u, o) => { sessions.close(u); await supervisor?.stopWorker(u, o.purge).catch(e => log('stopWorker', e)) } })

  registerLifecycleHandler({
    name: 'credentials',
    onUserBanned: async (u) => { await revokePatsOfUser(repo.db, u); await revokeOAuthGrantsOfUser(repo.db, u) },
  })

  const purge = setInterval(() => { void repo.purgeStats(STATS.retentionDays).catch(e => log('stats purge', e)) }, 24 * 3_600_000)
  purge.unref()

  const rt: Runtime = Object.assign(rtRef, {
    repo, gw, supervisor, imageTarget, draining: false,
    allow: async () => (await settings()).allow,
    invalidateSettings: () => { cache = null },
    async stdioPolicyFor(role, stdioAllowed) {
      let caps: { canSwitchUser: boolean } | undefined
      if (supervisor) { try { const c = await supervisor.capabilities(); caps = { canSwitchUser: c.canSwitchUser } } catch { caps = undefined } }
      return stdioPolicy({ imageTarget, instanceEnabled: (await settings()).stdio, role, stdioAllowed, supervisor: caps })
    },
  } satisfies Runtime)
  g.__mcpwStatsDropped = () => gw.stats.dropped
  g.__mcpwRuntimeStop = async () => {
    rt.draining = true
    clearInterval(purge)
    sessions.closeAll()
    await gw.shutdown(SHUTDOWN_DRAIN_MS)
  }
  return rt
}

export function getRuntime(): Promise<Runtime> {
  return (g.__mcpwRuntime ??= create())
}

/** Zähler `stats_dropped`: verworfene Messdatensätze seit Start (P0-15); 0 ohne Runtime. */
export function statsDropped(): number {
  return g.__mcpwStatsDropped?.() ?? 0
}

/** Drain läuft (für /readyz); ohne Runtime: false. */
export function isDraining(): boolean {
  return runtimeDraining
}
let runtimeDraining = false

/** SIGTERM-Beginn: /readyz meldet sofort 503, neue Verbindungen kommen nicht mehr an. */
export function markDraining(): void { runtimeDraining = true }

/** Graceful Shutdown: Aufrufe auslaufen lassen, Pool/Worker schließen, Stats flushen. Idempotent. */
export async function closeRuntime(): Promise<void> {
  runtimeDraining = true
  const p = g.__mcpwRuntime
  g.__mcpwRuntime = undefined
  if (!p) return
  await p.catch(() => undefined)
  await g.__mcpwRuntimeStop?.()
  g.__mcpwRuntimeStop = undefined
}
