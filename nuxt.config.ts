// https://nuxt.com/docs/api/configuration/nuxt-config
// Gemeinsame Datei, getrennte Blöcke (docs/plans/phase-0a.md, Abschnitt 3.2).
export default defineNuxtConfig({
  compatibilityDate: '2026-11-04',
  devtools: { enabled: false },

  // --- Backend (0a) ---
  nitro: { preset: 'node-server' },

  // --- Frontend ---
})
