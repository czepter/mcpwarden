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
  },
})
