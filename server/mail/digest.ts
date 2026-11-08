import type { GatewayRepo } from '../gateway/upstream/repo'
import { trySendMail } from './index'
import type { Mailer } from './types'
import { weeklyDigestMail } from './templates'

export const WEEK_MS = 7 * 24 * 3_600_000

/**
 * Sends the weekly summary to every opted-in user whose last mail is older than a week. Each user is claimed with a conditional update
 * first (idempotent across ticks and instances); a failed send hands the claim back so the next tick retries. Recipient is the user themself.
 * @returns number of mails sent
 */
export async function runWeeklyDigest(d: { repo: GatewayRepo, mailer: Mailer, baseUrl: string | URL, now?: Date, log?: (m: string) => void }): Promise<number> {
  if (!d.mailer.enabled) return 0
  const now = d.now ?? new Date()
  const before = new Date(now.getTime() - WEEK_MS)
  const log = d.log ?? (m => console.error(m))
  let sent = 0
  for (const u of await d.repo.weeklyDigestDue(before)) {
    try {
      if (!(await d.repo.claimWeekly(u.userId, before, now))) continue
      const [stats, attention] = await Promise.all([d.repo.statsSummary({ userId: u.userId, window: '7d' }, now), d.repo.attention(u.userId)])
      const slowest = [...stats.rows].filter(r => r.calls > 0).sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 3).map(r => ({ name: r.upstream, p95Ms: r.p95Ms, calls: r.calls }))
      const ok = await trySendMail(d.mailer, weeklyDigestMail(u.email, d.baseUrl, { calls: stats.calls, okRate: stats.okRate, activeClients: stats.activeClients, attention: attention.length, slowest }), 'weekly digest', log)
      if (ok) sent++
      else await d.repo.releaseWeekly(u.userId, now)
    } catch {
      log('[mcpwarden] mail: weekly digest failed for a user (internal)')
    }
  }
  return sent
}
