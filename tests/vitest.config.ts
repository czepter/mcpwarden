import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('..', import.meta.url))

// Minimale Konfiguration fuer Unit-Tests (Phase 0b, Teil 1). 0a liefert die vollstaendige Fassung
// samt Integrations-Harness; beim Merge gilt 0a, die Aliase unten muessen erhalten bleiben.
export default defineConfig({
  root,
  resolve: {
    alias: {
      '#shared': `${root}shared`,
      '~~': root,
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
  },
})
