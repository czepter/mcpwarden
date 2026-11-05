/**
 * Schutz gegen Cross-Site-Anfragen auf Cookie-authentifizierte, verändernde `/api/**`-Routen (Review M-G).
 * Better Auth prüft Origin nur unter `/api/auth/**`; die eigenen Routen (Upstreams, Secrets, Admin, PATs, ...) lesen JSON, aber auch
 * `application/x-www-form-urlencoded` oder gar keinen Body, was ein fremdes Formular oder `fetch(no-cors)` ohne Preflight senden kann.
 *  - Nicht verändernde Methoden (GET/HEAD/OPTIONS) und `/api/auth/**` (Better Auth) sind ausgenommen.
 *  - Anfragen mit `Authorization`-Header (PAT/Bearer) sind ausgenommen: ein Browser hängt ihn nie von selbst an.
 *  - Mit `Origin`: er muss in BASE_URL/ALLOWED_ORIGINS stehen. Ohne `Origin`: `Sec-Fetch-Site` darf nur `same-origin`/`none` sein.
 *  - Weder Origin noch Sec-Fetch-Site (kein Browser, z. B. curl): durchgelassen; ohne Cookie scheitert die Anmeldung ohnehin.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type CsrfInput = {
  method: string
  path: string
  origin?: string | null
  secFetchSite?: string | null
  hasAuthorization: boolean
  allowedOrigins: string[]
}

export function isCsrfViolation(i: CsrfInput): boolean {
  if (SAFE_METHODS.has(i.method.toUpperCase())) return false
  if (!i.path.startsWith('/api/') || i.path.startsWith('/api/auth/')) return false
  if (i.hasAuthorization) return false
  if (i.origin) return !i.allowedOrigins.includes(i.origin)
  const site = i.secFetchSite?.toLowerCase()
  return !!site && site !== 'same-origin' && site !== 'none'
}
