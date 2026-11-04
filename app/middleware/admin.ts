import { toast } from 'vue-sonner'

export default defineNuxtRouteMiddleware(() => {
  if (import.meta.server) return
  const { user } = useSessionUser()
  if (user.value?.role !== 'admin') {
    toast.error('Dieser Bereich ist nur für Admins.')
    return navigateTo('/')
  }
})
