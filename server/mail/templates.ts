import type { Mail } from './types'

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)
}

/**
 * Links are built exclusively from BASE_URL (origin) plus a fixed path. User input (Host header, redirectTo)
 * never flows in. The token is in the fragment: it ends up in no access log and no referer.
 */
export function buildLink(baseUrl: string | URL, path: string, fragment?: Record<string, string>): string {
  const u = new URL(path, new URL(baseUrl).origin)
  if (fragment) u.hash = new URLSearchParams(fragment).toString()
  return u.toString()
}

function layout(title: string, paragraphs: string[], link: string): string {
  const p = paragraphs.map(t => `<p>${escapeHtml(t)}</p>`).join('')
  return `<!doctype html><html lang="de"><body style="font-family:sans-serif;line-height:1.5"><h1 style="font-size:18px">${escapeHtml(title)}</h1>${p}<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p></body></html>`
}

export const RESET_TTL_MINUTES = 15

export function resetPasswordMail(to: string, baseUrl: string | URL, token: string): Mail {
  const link = buildLink(baseUrl, '/reset-password', { token })
  const intro = 'Für dein mcpwarden-Konto wurde ein neues Passwort angefordert.'
  const valid = `Der Link ist ${RESET_TTL_MINUTES} Minuten gültig und nur einmal verwendbar.`
  const ignore = 'Wenn du das nicht warst, ignoriere diese E-Mail. Dein Passwort bleibt unverändert.'
  return {
    to,
    subject: 'Passwort zurücksetzen',
    text: `${intro}\n\nNeues Passwort festlegen:\n${link}\n\n${valid}\n${ignore}\n`,
    html: layout('Passwort zurücksetzen', [intro, valid, ignore], link),
  }
}

export const INVITE_TTL_DAYS_TEXT = 7

/** Invitation. `link` is `/invite/<token>` from BASE_URL (the same link the admin sees). */
export function inviteMail(to: string, link: string): Mail {
  const intro = 'Du wurdest zu mcpwarden eingeladen.'
  const valid = `Der Link ist ${INVITE_TTL_DAYS_TEXT} Tage gültig und nur einmal verwendbar. Registrieren kannst du dich nur mit dieser E-Mail-Adresse.`
  const ignore = 'Wenn du diese Einladung nicht erwartet hast, ignoriere diese E-Mail.'
  return {
    to,
    subject: 'Einladung zu mcpwarden',
    text: `${intro}\n\nKonto anlegen:\n${link}\n\n${valid}\n${ignore}\n`,
    html: layout('Einladung zu mcpwarden', [intro, valid, ignore], link),
  }
}

const MAX_NAME = 60
const MAX_REASON = 200

/**
 * Makes foreign text (upstream name, statusReason) harmless for mails: control and line-separator characters removed,
 * whitespace collapsed, URLs, hostnames and addresses defused (no links from foreign text), truncated.
 */
export function sanitizeUntrusted(v: string | null | undefined, max: number): string {
  // Bound the input BEFORE the backtracking regexes run: foreign text (e.g. an anonymously registered client name) may be
  // arbitrarily long, and the regex cost would be paid synchronously on the event loop. Anything beyond is truncated anyway.
  let s = (v ?? '').slice(0, Math.max(max * 4, 256))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S*/gi, '[Link entfernt]')
    .replace(/\bwww\.\S*/gi, '[Link entfernt]')
    .replace(/\S+@\S+\.\S+/g, '[Adresse entfernt]')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`
  return s
}

export type NotifyState = 'open' | 'auth_expired' | 'healthy'

const STATE_TEXT: Record<NotifyState, { subject: string, headline: string }> = {
  open: { subject: 'nicht erreichbar', headline: 'ist derzeit nicht erreichbar (Schutzschalter offen)' },
  auth_expired: { subject: 'Anmeldung abgelehnt', headline: 'lehnt die hinterlegte Anmeldung ab (401/403). Bitte Zugangsdaten prüfen' },
  healthy: { subject: 'wieder erreichbar', headline: 'ist wieder erreichbar' },
}

/** Status mail to the owner: only name, state, sanitized reason and the link to the upstream page (from BASE_URL). */
export function upstreamStatusMail(to: string, baseUrl: string | URL, up: { id: string, name: string, state: NotifyState, reason: string | null }): Mail {
  const name = sanitizeUntrusted(up.name, MAX_NAME) || 'Upstream'
  const reason = up.state === 'healthy' ? '' : sanitizeUntrusted(up.reason, MAX_REASON)
  const link = buildLink(baseUrl, `/upstreams/${encodeURIComponent(up.id)}`)
  const settings = buildLink(baseUrl, '/settings')
  const t = STATE_TEXT[up.state]
  const intro = `Dein Upstream „${name}“ ${t.headline}.`
  const detail = reason ? `Grund: ${reason}` : ''
  const optOutShort = 'Du kannst diese Benachrichtigungen in den Einstellungen abschalten.'
  const text = [intro, detail, `Zum Upstream:\n${link}`, `${optOutShort}\n${settings}`].filter(Boolean).join('\n\n')
  return {
    to,
    subject: `mcpwarden: ${name} ${t.subject}`,
    text: `${text}\n`,
    html: layout(`${name}: ${t.subject}`, [intro, detail, optOutShort].filter(Boolean), link),
  }
}

/** "A client connected for the first time": name is foreign text (DCR), so it is sanitized; the link is fixed (from BASE_URL). */
export function newClientMail(to: string, baseUrl: string | URL, clientName: string | null): Mail {
  const name = sanitizeUntrusted(clientName, MAX_NAME).replace(/[<>]/g, '') || 'Ein unbekannter Client'
  const link = buildLink(baseUrl, '/settings/connections')
  const settings = buildLink(baseUrl, '/settings')
  const intro = `„${name}“ hat sich zum ersten Mal mit deinem mcpwarden-Konto verbunden.`
  const check = 'Warst du das nicht, widerrufe den Zugang unter „Clients“.'
  const optOut = 'Du kannst diese Benachrichtigung in den Einstellungen abschalten.'
  return {
    to,
    subject: `mcpwarden: Neuer Client verbunden (${name})`,
    text: `${intro}\n\n${check}\n${link}\n\n${optOut}\n${settings}\n`,
    html: layout('Neuer Client verbunden', [intro, check, optOut], link),
  }
}

export type WeeklyDigest = {
  calls: number
  okRate: number // 0..1
  activeClients: number
  attention: number
  slowest: Array<{ name: string, p95Ms: number, calls: number }>
}

/** Weekly summary: numbers only, upstream names sanitized, never call contents. */
export function weeklyDigestMail(to: string, baseUrl: string | URL, d: WeeklyDigest): Mail {
  const link = buildLink(baseUrl, '/stats')
  const settings = buildLink(baseUrl, '/settings')
  const pct = `${(d.okRate * 100).toFixed(1).replace('.', ',')} %`
  const lines = [
    d.calls === 0 ? 'In den letzten sieben Tagen gab es keine Aufrufe.' : `Aufrufe: ${d.calls} · Erfolgsquote: ${pct} · aktive Clients: ${d.activeClients}`,
    d.attention > 0 ? `${d.attention} Upstream${d.attention === 1 ? ' braucht' : 's brauchen'} deine Aufmerksamkeit.` : '',
    d.slowest.length ? `Langsamste Upstreams (p95): ${d.slowest.map(s => `${sanitizeUntrusted(s.name, MAX_NAME)} ${s.p95Ms} ms`).join(', ')}` : '',
  ].filter(Boolean)
  const optOut = 'Du kannst diese Zusammenfassung in den Einstellungen abschalten.'
  return {
    to,
    subject: 'mcpwarden: Deine Wochenübersicht',
    text: `${lines.join('\n')}\n\nZur Statistik:\n${link}\n\n${optOut}\n${settings}\n`,
    html: layout('Deine Wochenübersicht', [...lines, optOut], link),
  }
}
