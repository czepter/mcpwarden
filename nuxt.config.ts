import tailwindcss from '@tailwindcss/vite'
// https://nuxt.com/docs/api/configuration/nuxt-config
// Shared file, separate blocks (docs/plans/phase-0a.md, section 3.2).
export default defineNuxtConfig({
  compatibilityDate: '2026-11-04',
  devtools: { enabled: false },

  // --- Backend (0a) ---
  nitro: {
    preset: 'node-server',
    // Mock builds: serve the service worker only here, own output directory (never .output).
    ...(process.env.VITE_API_MOCK
      ? { publicAssets: [{ dir: new URL('./.mocks-public', import.meta.url).pathname, maxAge: 0 }], output: { dir: new URL('./.output-mock', import.meta.url).pathname } }
      : {}),
  },

  // --- Frontend ---
  ssr: !process.env.VITE_API_MOCK,
  modules: ['shadcn-nuxt', '@nuxtjs/i18n'],
  css: ['~/assets/css/tailwind.css'],
  // __API_MOCK__ is a compile-time constant ('' in the production build) and is optimized away together with the mock code.
  vite: { plugins: [tailwindcss()], define: { __API_MOCK__: JSON.stringify(process.env.VITE_API_MOCK ?? '') } },
  hooks: {
    // Copy migrations into the build artifact (runtime: .output/server/migrations).
    'nitro:init': (nitro) => {
      nitro.hooks.hook('compiled', async (n) => {
        const { cp } = await import('node:fs/promises')
        const { join } = await import('node:path')
        await cp(join(n.options.rootDir, 'server/db/migrations'), join(n.options.output.serverDir, 'migrations'), { recursive: true })
      })
    },
    // The styleguide (/__styleguide) exists only in mock builds.
    'pages:extend'(pages) {
      if (process.env.VITE_API_MOCK) return
      const i = pages.findIndex(p => p.path === '/__styleguide')
      if (i >= 0) pages.splice(i, 1)
    },
  },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  app: {
    head: {
      title: 'mcpwarden',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      // Theme before the first paint (no flash): reads the cookie `mcpw_theme` (see composables/useTheme.ts); 'system' follows prefers-color-scheme.
      script: [{ innerHTML: '(function(){try{var m=document.cookie.match(/(?:^|; )mcpw_theme=([^;]*)/);var t=m?decodeURIComponent(m[1]).replace(/"/g,\'\'):\'system\';var d=t===\'dark\'||(t!==\'light\'&&matchMedia(\'(prefers-color-scheme: dark)\').matches);document.documentElement.classList.toggle(\'dark\',d)}catch(e){}})()', tagPosition: 'head' }],
    },
    pageTransition: { name: 'page', mode: 'out-in' },
  },
  // English is the default; German is the second locale. No URL prefix: the locale comes from a cookie, then the browser language.
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', files: ['en/common.json', 'en/auth.json', 'en/upstreams.json', 'en/settings.json', 'en/admin.json', 'en/dashboard.json'] },
      { code: 'de', language: 'de-DE', name: 'Deutsch', files: ['de/common.json', 'de/auth.json', 'de/upstreams.json', 'de/settings.json', 'de/admin.json', 'de/dashboard.json'] },
    ],
    detectBrowserLanguage: { useCookie: true, cookieKey: 'mcpw_locale', fallbackLocale: 'en', redirectOn: 'root' },
  },
})
