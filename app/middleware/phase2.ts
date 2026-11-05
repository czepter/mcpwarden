// Pages without a phase 1 backend (statistics, auth links, stdio approval) exist only in the mock build; otherwise back to the dashboard.
import { FEATURES } from '~/lib/features'

export default defineNuxtRouteMiddleware(() => {
  if (!FEATURES.phase2) return navigateTo('/')
})
