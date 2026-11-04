import tailwindcss from '@tailwindcss/vite'
// https://nuxt.com/docs/api/configuration/nuxt-config
// Gemeinsame Datei, getrennte Blöcke (docs/plans/phase-0a.md, Abschnitt 3.2).
export default defineNuxtConfig({
  compatibilityDate: '2026-11-04',
  devtools: { enabled: false },

  // --- Backend (0a) ---
  nitro: { preset: 'node-server' },

  // --- Frontend ---
  ssr: !process.env.VITE_API_MOCK,
  modules: ['shadcn-nuxt'],
  css: ['~/assets/css/tailwind.css'],
  vite: { plugins: [tailwindcss()] },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  app: { head: { htmlAttrs: { lang: 'de' }, title: 'mcpwarden' } },
})
