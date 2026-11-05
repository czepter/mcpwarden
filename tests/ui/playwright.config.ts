import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  // PW_CHROMIUM_PATH: optionaler Pfad zu einem vorinstallierten Chromium (z. B. in Sandboxes ohne `playwright install`).
  use: {
    baseURL: 'http://localhost:3101',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ['--no-sandbox'] } : {},
  },
  webServer: {
    command: 'PORT=3101 node .output-mock/server/index.mjs',
    url: 'http://localhost:3101',
    reuseExistingServer: false,
    timeout: 60_000,
    cwd: '../..',
    // Der Mock-Build enthält auch den Backend-Server (Fail-fast-Konfiguration); die UI spricht im Test nur mit MSW.
    // Reine Wegwerf-Testwerte, keine Geheimnisse; PGlite liegt in einem Temp-Verzeichnis.
    env: {
      BASE_URL: 'http://localhost:3101',
      BETTER_AUTH_SECRET: 'e2e-only-secret-not-for-production-0123456789',
      MASTER_KEY: '00'.repeat(32),
      DATA_DIR: mkdtempSync(join(tmpdir(), 'mcpw-e2e-')),
    },
  },
})
