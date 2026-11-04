// Ohne Sitzung nur /login, /register, /invite/*. Die signierte OAuth-Query bleibt unveraendert erhalten (0b R14).
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return // A5: Sitzung wird nur im Browser geprueft; die Server-Seite prueft jede Route selbst.
  const isPublic = to.path === '/login' || to.path === '/register' || to.path.startsWith('/invite/')
  const { user, load } = useSessionUser()
  await load()
  if (!user.value || user.value.banned) {
    if (isPublic) return
    const query = to.path === '/consent' ? { ...to.query, redirect: to.fullPath } : to.fullPath === '/' ? {} : { redirect: to.fullPath }
    return navigateTo({ path: '/login', query })
  }
  if (to.path === '/login' || to.path === '/register') return navigateTo('/')
})
