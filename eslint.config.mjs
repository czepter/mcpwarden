import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({}).prepend({
  ignores: ['app/components/ui', 'public/mockServiceWorker.js', '.nuxt', '.output', '.output-mock', '.mocks-public', 'node_modules', 'data', 'docs'],
}).append({
  rules: { 'vue/no-multiple-template-root': 'off', 'vue/no-template-shadow': 'off' },
})
