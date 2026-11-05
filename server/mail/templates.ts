import type { Mail } from './types'

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)
}

/**
 * Links entstehen ausschliesslich aus BASE_URL (Origin) plus festem Pfad. Nutzereingaben (Host-Header, redirectTo)
 * fliessen nie ein. Das Token steht im Fragment: es landet in keinem Access-Log und keinem Referer.
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
