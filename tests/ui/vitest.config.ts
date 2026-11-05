import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': r('../../app'), '~': r('../../app'), '#shared': r('../../shared'), '~~': r('../..') },
  },
  test: {
    root: r('../..'),
    include: ['tests/ui/{unit,component,contract}/**/*.test.ts'],
    environment: 'happy-dom',
    environmentOptions: { happyDOM: { url: 'http://localhost:3000' } },
  },
})
