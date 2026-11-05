export default defineNuxtRouteMiddleware(() => {
  if (import.meta.server) return
  const { user } = useSessionUser()
  if (user.value?.role !== 'admin') {
    return navigateTo({ path: '/', query: { hinweis: 'admin' } })
  }
})
