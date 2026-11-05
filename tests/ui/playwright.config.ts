import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// E2E_PORT: free port in case 3101 is taken (e.g. parallel run).
const PORT = process.env.E2E_PORT ?? '3101'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  // PW_CHROMIUM_PATH: optional path to a preinstalled Chromium (e.g. in sandboxes without `playwright install`).
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: {
    command: `PORT=${PORT} node .output-mock/server/index.mjs`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: '../..',
    // The mock build also contains the backend server (fail-fast configuration); in the test the UI talks only to MSW.
    // Pure throwaway test values, no secrets; PGlite lives in a temp directory.
    env: {
      BASE_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: 'e2e-only-secret-not-for-production-0123456789',
      MASTER_KEY: '00'.repeat(32),
      DATA_DIR: mkdtempSync(join(tmpdir(), 'mcpw-e2e-')),
    },
  },
})
