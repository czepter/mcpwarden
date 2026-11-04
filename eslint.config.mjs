import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({}).prepend({
  ignores: ['app/components/ui', 'public/mockServiceWorker.js', '.nuxt', '.output', 'node_modules', 'data', 'docs'],
})
