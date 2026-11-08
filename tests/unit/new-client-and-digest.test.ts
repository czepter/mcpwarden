import { describe, expect, it } from 'vitest'
import { runWeeklyDigest, WEEK_MS } from '../../server/mail/digest'
import { createMemoryMailer } from '../../server/mail/memory'
import { createNoopMailer } from '../../server/mail/noop'
import { createNewClientNotifier } from '../../server/mail/notify'
import { newClientMail, weeklyDigestMail } from '../../server/mail/templates'
import { MailError } from '../../server/mail/types'
import type { GatewayRepo } from '../../server/gateway/upstream/repo'

const BASE = 'https://mcp.example.com'
const EVIL = '<img src=x onerror=alert(1)> https://evil.example/phish me@evil.example\r\nBcc: x@y.de ' + 'A'.repeat(500)

describe('Mail "new client connected"', () => {
  it('names the client, links to the clients page from BASE_URL and defuses foreign text', () => {
    const m = newClientMail('a@example.com', `${BASE}/x?y=1`, EVIL)
    expect(m.subject).not.toMatch(/[\r\n]/)
    expect(m.html).not.toContain('<img')
    for (const body of [m.text, m.html!, m.subject]) { expect(body).not.toContain('evil.example'); expect(body).not.toContain('Bcc:\r') }
    expect([...m.text.matchAll(/https?:\/\/\S+/g)].map(x => x[0])).toEqual([`${BASE}/settings/connections`, `${BASE}/settings`])
    expect(newClientMail('a@example.com', BASE, null).text).toContain('unbekannter Client')
  })
  it('notifier: sends to the owner only when opted in, never for noop mailer, bounded queue', async () => {
    const mailer = createMemoryMailer()
    const lookups: string[] = []
    const n = createNewClientNotifier({
      mailer, baseUrl: BASE, log: () => {},
      lookup: async (u, c) => { lookups.push(`${u}:${c}`); return u === 'off' ? { email: 'off@example.com', notify: false, clientName: 'X' } : u === 'gone' ? null : { email: `${u}@example.com`, notify: true, clientName: 'Claude Code' } },
    })
    expect(n.notify('on', 'c1')).toBe(true)
    n.notify('off', 'c1')
    n.notify('gone', 'c1')
    await n.idle()
    expect(mailer.outbox.map(m => m.to)).toEqual(['on@example.com'])
    expect(mailer.outbox[0]!.subject).toContain('Claude Code')

    const noop = createNewClientNotifier({ mailer: createNoopMailer(), baseUrl: BASE, lookup: async () => { throw new Error('must not be read') } })
    expect(noop.notify('on', 'c1')).toBe(false)

    const slow = createNewClientNotifier({ mailer, baseUrl: BASE, log: () => {}, maxPending: 1, lookup: () => new Promise(() => {}) })
    expect(slow.notify('a', 'c')).toBe(true)
    expect(slow.notify('b', 'c')).toBe(false) // queue full -> dropped
  })
  it('a failing send never throws', async () => {
    const mailer = createMemoryMailer()
    mailer.failWith = new MailError('send_failed', 'x')
    const n = createNewClientNotifier({ mailer, baseUrl: BASE, log: () => {}, lookup: async () => ({ email: 'a@example.com', notify: true, clientName: 'C' }) })
    expect(n.notify('u', 'c')).toBe(true)
    await expect(n.idle()).resolves.toBeUndefined()
  })
})

describe('Weekly summary', () => {
  it('mail: numbers, sanitized upstream names, link to the statistics page, opt-out hint', () => {
    const m = weeklyDigestMail('a@example.com', BASE, { calls: 1200, okRate: 0.9731, activeClients: 3, attention: 2, slowest: [{ name: EVIL, p95Ms: 840, calls: 10 }] })
    expect(m.subject).toBe('mcpwarden: Deine Wochenübersicht')
    expect(m.text).toContain('1200')
    expect(m.text).toContain('97,3 %')
    expect(m.text).toContain('2 Upstreams brauchen')
    expect(m.text).toContain(`${BASE}/stats`)
    expect(m.text).toContain('abschalten')
    expect(m.html).not.toContain('<img')
    expect(m.text).not.toContain('evil.example')
    expect(weeklyDigestMail('a@example.com', BASE, { calls: 0, okRate: 0, activeClients: 0, attention: 0, slowest: [] }).text).toContain('keine Aufrufe')
  })

  function fakeRepo(users: Array<{ userId: string, email: string, name: string }>) {
    const claimed = new Map<string, Date | null>(users.map(u => [u.userId, null]))
    const released: string[] = []
    const repo = {
      weeklyDigestDue: async () => users.filter(u => claimed.get(u.userId) === null),
      claimWeekly: async (id: string, _b: Date, now: Date) => { if (claimed.get(id) !== null) return false; claimed.set(id, now); return true },
      releaseWeekly: async (id: string) => { released.push(id); claimed.set(id, null) },
      statsSummary: async (q: { userId?: string }) => ({ calls: q.userId === 'u1' ? 10 : 0, okRate: 1, activeClients: 1, rows: [{ upstream: 'github', calls: 10, p95Ms: 200 }, { upstream: 'slow', calls: 3, p95Ms: 900 }, { upstream: 'idle', calls: 0, p95Ms: 0 }] }),
      attention: async () => [],
    } as unknown as GatewayRepo
    return { repo, claimed, released }
  }

  it('sends one mail per opted-in user to the user themself, and only once per week (claim)', async () => {
    const mailer = createMemoryMailer()
    const { repo } = fakeRepo([{ userId: 'u1', email: 'u1@example.com', name: 'U1' }, { userId: 'u2', email: 'u2@example.com', name: 'U2' }])
    const now = new Date('2026-11-09T07:00:00Z')
    expect(await runWeeklyDigest({ repo, mailer, baseUrl: BASE, now, log: () => {} })).toBe(2)
    expect(mailer.outbox.map(m => m.to).sort()).toEqual(['u1@example.com', 'u2@example.com'])
    expect(mailer.outbox[0]!.text).toContain('slow 900 ms') // slowest first, idle upstream left out
    expect(await runWeeklyDigest({ repo, mailer, baseUrl: BASE, now: new Date(now.getTime() + 3_600_000), log: () => {} })).toBe(0)
    expect(mailer.outbox).toHaveLength(2)
    expect(WEEK_MS).toBe(7 * 86_400_000)
  })
  it('a failed send hands the claim back (retry on the next tick); noop mailer does nothing', async () => {
    const mailer = createMemoryMailer()
    const { repo, released } = fakeRepo([{ userId: 'u1', email: 'u1@example.com', name: 'U1' }])
    mailer.failWith = new MailError('send_failed', 'x')
    expect(await runWeeklyDigest({ repo, mailer, baseUrl: BASE, log: () => {} })).toBe(0)
    expect(released).toEqual(['u1'])
    mailer.failWith = undefined
    expect(await runWeeklyDigest({ repo, mailer, baseUrl: BASE, log: () => {} })).toBe(1)
    expect(await runWeeklyDigest({ repo, mailer: createNoopMailer(), baseUrl: BASE })).toBe(0)
  })
})
