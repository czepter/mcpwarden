import type { AuthSessionUser } from '#shared/api-types'
import { authApi } from '~/api'

export function useSessionUser() {
  const user = useState<AuthSessionUser | null>('session-user', () => null)
  const loaded = useState('session-loaded', () => false)
  async function load(force = false) {
    if (loaded.value && !force) return user.value
    try { user.value = (await authApi.session())?.user ?? null } catch { user.value = null }
    loaded.value = true
    return user.value
  }
  async function logout() {
    try { await authApi.signOut() } finally {
      user.value = null; loaded.value = true
      // A9: Stores beim Abmelden leeren.
      clearNuxtState()
      await navigateTo('/login')
    }
  }
  const isAdmin = computed(() => user.value?.role === 'admin')
  return { user, isAdmin, load, logout }
}
