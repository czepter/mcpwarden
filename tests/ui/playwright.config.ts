import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

// E2E_PORT: freier Port, falls 3101 belegt ist (z. B. paralleler Lauf).
const PORT = process.env.E2E_PORT ?? '3101'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  // PW_CHROMIUM_PATH: optionaler Pfad zu einem vorinstallierten Chromium (z. B. in Sandboxes ohne `playwright install`).
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
    // Der Mock-Build enthält auch den Backend-Server (Fail-fast-Konfiguration); die UI spricht im Test nur mit MSW.
    // Reine Wegwerf-Testwerte, keine Geheimnisse; PGlite liegt in einem Temp-Verzeichnis.
    env: {
      BASE_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: 'e2e-only-secret-not-for-production-0123456789',
      MASTER_KEY: '00'.repeat(32),
      DATA_DIR: mkdtempSync(join(tmpdir(), 'mcpw-e2e-')),
    },
  },
})
