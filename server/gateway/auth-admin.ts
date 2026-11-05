import type { H3Event } from 'h3'
import { getAuth } from '../auth'
import type { AuthAdminApi } from './service'

/** Better-Auth-Admin-API mit den Headern der aufrufenden Admin-Sitzung (Rechteprüfung macht Better Auth selbst). */
export async function authAdminApi(event: H3Event): Promise<AuthAdminApi> {
  const auth = await getAuth()
  const headers = event.headers
  return {
    banUser: o => auth.api.banUser({ headers, body: o }),
    unbanUser: o => auth.api.unbanUser({ headers, body: o }),
    removeUser: o => auth.api.removeUser({ headers, body: o }),
  }
}
