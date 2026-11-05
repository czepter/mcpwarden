// https://nuxt.com/docs/api/configuration/nuxt-config
// Gemeinsame Datei, getrennte Blöcke (docs/plans/phase-0a.md, Abschnitt 3.2).
export default defineNuxtConfig({
  compatibilityDate: '2026-11-04',
  devtools: { enabled: false },

  // --- Backend (0a) ---
  nitro: { preset: 'node-server' },
  hooks: {
    // Migrationen ins Build-Artefakt kopieren (Laufzeit: .output/server/migrations).
    'nitro:init': (nitro) => {
      nitro.hooks.hook('compiled', async (n) => {
        const { cp } = await import('node:fs/promises')
        const { join } = await import('node:path')
        await cp(join(n.options.rootDir, 'server/db/migrations'), join(n.options.output.serverDir, 'migrations'), { recursive: true })
      })
    },
  },

  // --- Frontend ---
})
