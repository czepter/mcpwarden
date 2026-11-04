import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  use: { baseURL: 'http://localhost:3101' },
  webServer: {
    command: 'PORT=3101 node .output-mock/server/index.mjs',
    url: 'http://localhost:3101',
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: '../..',
  },
})
