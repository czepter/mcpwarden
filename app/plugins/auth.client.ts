import { setUnauthorizedHandler } from '~/api/http'

export default defineNuxtPlugin(() => {
  setUnauthorizedHandler(() => {
    const { user } = useSessionUser()
    user.value = null
    const route = useRoute()
    if (route.path !== '/login') navigateTo({ path: '/login', query: route.path === '/' ? {} : { redirect: route.fullPath } })
  })
})
