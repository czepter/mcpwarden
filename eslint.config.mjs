import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({}).prepend({
  ignores: ['.nuxt', '.output', 'node_modules', 'data', 'docs'],
})
