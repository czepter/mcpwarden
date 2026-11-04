import tailwindcss from '@tailwindcss/vite'
// https://nuxt.com/docs/api/configuration/nuxt-config
// Gemeinsame Datei, getrennte Blöcke (docs/plans/phase-0a.md, Abschnitt 3.2).
export default defineNuxtConfig({
  compatibilityDate: '2026-11-04',
  devtools: { enabled: false },

  // --- Backend (0a) ---
  nitro: {
    preset: 'node-server',
    // Mock-Builds: Service Worker nur hier ausliefern, eigenes Ausgabeverzeichnis (nie .output).
    ...(process.env.VITE_API_MOCK
      ? { publicAssets: [{ dir: new URL('./.mocks-public', import.meta.url).pathname, maxAge: 0 }], output: { dir: new URL('./.output-mock', import.meta.url).pathname } }
      : {}),
  },

  // --- Frontend ---
  ssr: !process.env.VITE_API_MOCK,
  modules: ['shadcn-nuxt'],
  css: ['~/assets/css/tailwind.css'],
  // __API_MOCK__ ist eine Kompilier-Konstante ('' im Produktions-Build) und wird samt Mock-Code wegoptimiert.
  vite: { plugins: [tailwindcss()], define: { __API_MOCK__: JSON.stringify(process.env.VITE_API_MOCK ?? '') } },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  app: { head: { htmlAttrs: { lang: 'de' }, title: 'mcpwarden' } },
})
