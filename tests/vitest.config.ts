import { defineConfig } from 'vitest/config'

const root = new URL('..', import.meta.url).pathname

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', root, include: ['tests/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'integration',
          root,
          include: ['tests/integration/**/*.test.ts'],
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
})
