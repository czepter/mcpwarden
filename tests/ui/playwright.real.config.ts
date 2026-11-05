import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// E2E against the REAL backend: the production build (`pnpm build` -> .output), embedded PGlite, no mocks.
// E2E_REAL_PORT: free port in case 3102 is taken. State lives in a temp directory (throwaway test values, no secrets).
const PORT = process.env.E2E_REAL_PORT ?? '3102'
const BASE = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e-real',
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: BASE,
    // PW_CHROMIUM_PATH: optional path to a preinstalled Chromium (e.g. in sandboxes without `playwright install`).
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: {
    command: 'node .output/server/index.mjs',
    url: `${BASE}/readyz`,
    reuseExistingServer: false,
    timeout: 90_000,
    cwd: '../..',
    env: {
      NODE_ENV: 'production',
      PORT,
      HOST: '127.0.0.1',
      BASE_URL: BASE,
      BETTER_AUTH_SECRET: 'e2e-real-secret-not-for-production-0123456789',
      MASTER_KEY: 'cd'.repeat(32),
      DATA_DIR: mkdtempSync(join(tmpdir(), 'mcpw-e2e-real-')),
      RATE_LIMIT: 'off',
    },
  },
})
