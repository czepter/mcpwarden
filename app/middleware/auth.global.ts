// Without a session only /login, /register, /forgot-password, /reset-password, /invite/*. The signed OAuth query is preserved unchanged (0b R14).
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return // A5: the session is checked only in the browser; the server side checks every route itself.
  const isPublic = to.path === '/login' || to.path === '/register' || to.path === '/forgot-password' || to.path === '/reset-password' || to.path.startsWith('/invite/')
  const { user, load } = useSessionUser()
  await load()
  if (!user.value || user.value.banned) {
    if (isPublic) return
    const query = to.path === '/consent' ? { ...to.query, redirect: to.fullPath } : to.fullPath === '/' ? {} : { redirect: to.fullPath }
    return navigateTo({ path: '/login', query })
  }
  if (to.path === '/login' || to.path === '/register') return navigateTo('/')
})
