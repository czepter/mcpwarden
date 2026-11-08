import type { ThemePreference } from '#shared/api-types'

export const THEME_COOKIE = 'mcpw_theme'
const VALID: ThemePreference[] = ['system', 'light', 'dark']
const norm = (v: unknown): ThemePreference => (VALID.includes(v as ThemePreference) ? v as ThemePreference : 'system')

/**
 * Appearance. The server-side setting (`GET /api/me/settings`) is the source of truth; the cookie `mcpw_theme` mirrors it so that the
 * inline script in `<head>` (nuxt.config) can set the `dark` class before the first paint. 'system' follows `prefers-color-scheme`.
 */
export function useTheme() {
  const cookie = useCookie<string>(THEME_COOKIE, { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', path: '/', default: () => 'system' })
  const theme = useState<ThemePreference>('theme', () => norm(cookie.value))
  function isDark(t: ThemePreference = theme.value) {
    return t === 'dark' || (t === 'system' && import.meta.client && matchMedia('(prefers-color-scheme: dark)').matches)
  }
  function apply() {
    if (import.meta.client) document.documentElement.classList.toggle('dark', isDark())
  }
  /** Local change (cookie + class); persisting on the server is up to the caller. */
  function setTheme(t: ThemePreference) {
    theme.value = norm(t)
    cookie.value = theme.value
    apply()
  }
  return { theme, setTheme, apply, isDark }
}
