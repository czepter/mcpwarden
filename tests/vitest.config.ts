import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const alias = {
  '#shared': `${root}shared`,
  '~~': root,
}

export default defineConfig({
  root,
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', root, include: ['tests/unit/**/*.test.ts'], pool: 'forks' },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          root,
          include: ['tests/integration/**/*.test.ts'],
          exclude: ['tests/integration/container-*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
          pool: 'forks',
        },
      },
    ],
  },
})
