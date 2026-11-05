import { describe, expect, it, vi } from 'vitest'
import { createMemoryMailer } from '../../server/mail/memory'
import { createNoopMailer } from '../../server/mail/noop'
import { createStatusNotifier, notifyStateFor, type StatusChange } from '../../server/mail/notify'
import { inviteMail, sanitizeUntrusted, upstreamStatusMail } from '../../server/mail/templates'
import { MailError } from '../../server/mail/types'
import { parseConfig } from '../../server/utils/config'

const BASE = 'https://mcp.example.com'
const UP = '0b1c2d3e-0000-4000-8000-000000000001'
const change = (over: Partial<StatusChange> = {}): StatusChange => ({ upstreamId: UP, userId: 'u1', status: 'open', previous: 'healthy', reason: '5 Fehler in Folge, Breaker offen', ...over })

describe('Statusmail-Vorlage', () => {
  it('enthaelt Name, Zustand, Grund und einen Link auf die Upstream-Seite aus BASE_URL', () => {
    const m = upstreamStatusMail('a@example.com', `${BASE}/irgendein/pfad?x=1`, { id: UP, name: 'GitHub', state: 'open', reason: '5 Fehler in Folge, Breaker offen' })
    expect(m.subject).toBe('mcpwarden: GitHub nicht erreichbar')
    expect(m.text).toContain('GitHub')
    expect(m.text).toContain('5 Fehler in Folge')
    expect(m.text).toContain(`${BASE}/upstreams/${UP}`)
    expect(m.text).toContain(`${BASE}/settings`)
    expect(m.html).toContain(`href="${BASE}/upstreams/${UP}"`)
  })
  it('auth_expired und healthy haben eigene Texte; healthy zeigt keinen Grund', () => {
    expect(upstreamStatusMail('a@example.com', BASE, { id: UP, name: 'X', state: 'auth_expired', reason: 'r' }).subject).toContain('Anmeldung abgelehnt')
    const ok = upstreamStatusMail('a@example.com', BASE, { id: UP, name: 'X', state: 'healthy', reason: 'alter Grund' })
    expect(ok.subject).toContain('wieder erreichbar')
    expect(ok.text).not.toContain('alter Grund')
  })
  it('behandelt Name und Grund als nicht vertrauenswuerdig: HTML escaped, keine Links, keine Zeilenumbrueche im Betreff, gekuerzt', () => {
    const evil = '<img src=x onerror=alert(1)> https://evil.example/phish www.evil.example\r\nBcc: x@y.de mail me@evil.example\u2028 ' + 'A'.repeat(1000)
    const m = upstreamStatusMail('a@example.com', BASE, { id: UP, name: evil, state: 'open', reason: evil })
    expect(m.subject).not.toMatch(/[\r\n\u2028]/)
    expect(m.subject.length).toBeLessThanOrEqual(200)
    expect(m.html).not.toContain('<img')
    expect(m.html).toContain('&lt;img')
    for (const body of [m.text, m.html!, m.subject]) {
      expect(body).not.toContain('evil.example')
      expect(body).not.toContain('www.')
      expect(body).not.toContain('Bcc:\r')
    }
    expect(m.text).not.toContain('A'.repeat(300))
    expect(m.text).toContain('…')
    // der einzige Link ist der eigene
    expect([...m.text.matchAll(/https?:\/\/\S+/g)].map(x => x[0])).toEqual([`${BASE}/upstreams/${UP}`, `${BASE}/settings`])
  })
  it('sanitizeUntrusted: null, Steuerzeichen, Bidi-Zeichen', () => {
    expect(sanitizeUntrusted(null, 10)).toBe('')
    expect(sanitizeUntrusted('a\u0000b\u202ec\u0007d', 20)).toBe('a b c d')
    expect(sanitizeUntrusted('ftp://x.example/y und javascript://z', 100)).toBe('[Link entfernt] und [Link entfernt]')
  })
  it('Einladungsmail: Link im Text und HTML, escaped', () => {
    const link = `${BASE}/invite/abc_DEF-123`
    const m = inviteMail('neu@example.com', link)
    expect(m.to).toBe('neu@example.com')
    expect(m.text).toContain(link)
    expect(m.html).toContain(`href="${link}"`)
  })
})

describe('Ausloeser', () => {
  it('open und auth_expired immer, healthy nur nach open/auth_expired, sonst nichts', () => {
    expect(notifyStateFor('open', 'degraded')).toBe('open')
    expect(notifyStateFor('auth_expired', 'healthy')).toBe('auth_expired')
    expect(notifyStateFor('healthy', 'open')).toBe('healthy')
    expect(notifyStateFor('healthy', 'auth_expired')).toBe('healthy')
    expect(notifyStateFor('healthy', 'unknown')).toBeNull()
    expect(notifyStateFor('degraded', 'healthy')).toBeNull()
    expect(notifyStateFor('disabled', 'open')).toBeNull()
  })
})

function setup(over: { notify?: boolean, windowMs?: number, maxPending?: number } = {}) {
  const mailer = createMemoryMailer()
  let t = 1_000_000
  const log = vi.fn()
  const lookup = vi.fn(async (userId: string, _up: string) => userId === 'u1' ? { email: 'owner@example.com', name: 'GitHub', notify: over.notify ?? true } : userId === 'u2' ? { email: 'other@example.com', name: 'Mein', notify: true } : null)
  const n = createStatusNotifier({ mailer, baseUrl: BASE, windowMs: over.windowMs ?? 3_600_000, now: () => t, log, lookup, maxPending: over.maxPending })
  return { mailer, n, log, lookup, advance: (ms: number) => { t += ms } }
}

describe('Benachrichtigung', () => {
  it('sendet an den Besitzer; ohne aktiven Mailer passiert nichts (nicht einmal ein DB-Zugriff)', async () => {
    const s = setup()
    expect(s.n.notify(change())).toBe(true)
    await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(1)
    expect(s.mailer.outbox[0]!.to).toBe('owner@example.com')

    const lookup = vi.fn()
    const off = createStatusNotifier({ mailer: createNoopMailer(), baseUrl: BASE, windowMs: 1000, lookup })
    expect(off.notify(change())).toBe(false)
    await off.idle()
    expect(lookup).not.toHaveBeenCalled()
  })
  it('Drosselung: hoechstens eine Mail je (Upstream, Zustand) im Fenster, danach wieder', async () => {
    const s = setup()
    s.n.notify(change()); await s.n.idle()
    s.advance(60_000)
    s.n.notify(change()); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(1)
    // anderer Zustand desselben Upstreams ist nicht gedrosselt
    s.n.notify(change({ status: 'auth_expired' })); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(2)
    // anderer Upstream auch nicht
    s.n.notify(change({ upstreamId: 'zweiter' })); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(3)
    s.advance(3_600_000)
    s.n.notify(change()); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(4)
  })
  it('Flapping: 100 Wechsel open/healthy im Fenster ergeben genau eine Alarm- und eine Erholungsmail', async () => {
    const s = setup()
    for (let i = 0; i < 100; i++) {
      s.n.notify(change({ status: 'open', previous: 'healthy' }))
      s.n.notify(change({ status: 'healthy', previous: 'open', reason: null }))
      s.advance(1000)
    }
    await s.n.idle()
    expect(s.mailer.outbox.map(m => m.subject)).toEqual(['mcpwarden: GitHub nicht erreichbar', 'mcpwarden: GitHub wieder erreichbar'])
  })
  it('gleichzeitige Ereignisse desselben Schluessels: nur eine Mail', async () => {
    const s = setup()
    for (let i = 0; i < 10; i++) s.n.notify(change())
    await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(1)
  })
  it('Opt-out: keine Mail und kein verbrauchtes Fenster (spaeteres Einschalten wirkt sofort)', async () => {
    const s = setup({ notify: false })
    s.n.notify(change()); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(0)
    s.lookup.mockImplementation(async () => ({ email: 'owner@example.com', name: 'GitHub', notify: true }))
    s.n.notify(change()); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(1)
  })
  it('Mandantentrennung: Empfaenger kommt immer aus dem Besitzer-Lookup, nie aus dem Ereignis; unbekannter Besitzer = nichts', async () => {
    const s = setup()
    s.n.notify(change({ userId: 'u2', upstreamId: 'b' })); await s.n.idle()
    expect(s.mailer.outbox.map(m => m.to)).toEqual(['other@example.com'])
    expect(s.lookup).toHaveBeenCalledWith('u2', 'b')
    s.n.notify(change({ userId: 'weg', upstreamId: 'c' })); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(1)
  })
  it('Versandfehler und Lookup-Fehler werfen nie und loggen weder Adresse noch Grund', async () => {
    const s = setup()
    s.mailer.failWith = new MailError('transport', 'geheim: owner@example.com')
    expect(() => s.n.notify(change())).not.toThrow()
    await s.n.idle()
    s.lookup.mockRejectedValueOnce(new Error('db down owner@example.com'))
    expect(() => s.n.notify(change({ status: 'auth_expired' }))).not.toThrow()
    await s.n.idle()
    const logged = s.log.mock.calls.map(c => String(c[0])).join('\n')
    expect(logged).toContain('transport')
    expect(logged).not.toContain('owner@example.com')
    expect(logged).not.toContain('Breaker')
  })
  it('Warteschlange ist begrenzt: darueber wird verworfen statt aufgestaut', async () => {
    const s = setup({ maxPending: 2 })
    s.lookup.mockImplementation(() => new Promise(() => {})) // haengt
    expect(s.n.notify(change({ upstreamId: 'a' }))).toBe(true)
    expect(s.n.notify(change({ upstreamId: 'b' }))).toBe(true)
    expect(s.n.notify(change({ upstreamId: 'c' }))).toBe(false)
    expect(s.log).toHaveBeenCalledWith(expect.stringContaining('Warteschlange voll'))
  })
  it('notify blockiert nicht: kehrt zurueck, bevor der Versand fertig ist', async () => {
    const s = setup()
    let release!: () => void
    s.lookup.mockImplementation(() => new Promise(r => { release = () => r({ email: 'owner@example.com', name: 'G', notify: true }) }))
    expect(s.n.notify(change())).toBe(true)
    expect(s.mailer.outbox).toHaveLength(0)
    release(); await s.n.idle()
    expect(s.mailer.outbox).toHaveLength(1)
  })
})

describe('MAIL_NOTIFY_WINDOW_MIN', () => {
  const ok = { BASE_URL: 'https://mcp.example.com', BETTER_AUTH_SECRET: 'x'.repeat(32), MASTER_KEY: 'ab'.repeat(32) }
  it('Default 60, konfigurierbar, ungueltig ist ein Startfehler', () => {
    expect(parseConfig(ok).statusMailWindowMin).toBe(60)
    expect(parseConfig({ ...ok, MAIL_NOTIFY_WINDOW_MIN: '15' }).statusMailWindowMin).toBe(15)
    for (const bad of ['0', '-1', 'abc', '1.5', '99999']) expect(() => parseConfig({ ...ok, MAIL_NOTIFY_WINDOW_MIN: bad })).toThrow(/MAIL_NOTIFY_WINDOW_MIN/)
  })
})
