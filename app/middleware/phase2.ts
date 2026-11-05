// Seiten ohne Phase-1-Backend (Statistik, Auth-Links, stdio-Freigabe) gibt es nur im Mock-Build; sonst zurueck zum Dashboard.
import { FEATURES } from '~/lib/features'

export default defineNuxtRouteMiddleware(() => {
  if (!FEATURES.phase2) return navigateTo('/')
})
