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
  hooks: {
    // Migrationen ins Build-Artefakt kopieren (Laufzeit: .output/server/migrations).
    'nitro:init': (nitro) => {
      nitro.hooks.hook('compiled', async (n) => {
        const { cp } = await import('node:fs/promises')
        const { join } = await import('node:path')
        await cp(join(n.options.rootDir, 'server/db/migrations'), join(n.options.output.serverDir, 'migrations'), { recursive: true })
      })
    },
    // Der Styleguide (/__styleguide) existiert nur in Mock-Builds.
    'pages:extend'(pages) {
      if (process.env.VITE_API_MOCK) return
      const i = pages.findIndex(p => p.path === '/__styleguide')
      if (i >= 0) pages.splice(i, 1)
    },
  },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  app: { head: { htmlAttrs: { lang: 'de' }, title: 'mcpwarden' } },
})
