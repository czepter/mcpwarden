import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

// Container-Tests (Docker nötig): pnpm test:container
export default defineConfig({
  root,
  test: {
    include: ['tests/integration/container-*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 300_000,
    pool: 'forks',
    fileParallelism: false,
  },
})
