import { getConfig } from '../utils/config'
import { inlineScriptHashes, pageCsp } from '../utils/security-headers'

// Page CSP: computed from the rendered document so the inline scripts Nuxt emits are allowed by hash and nothing else is.
// Skipped in dev (HMR needs inline/eval scripts and a websocket).
export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return
  nitroApp.hooks.hook('render:response', (response) => {
    const type = response.headers?.['content-type']
    if (typeof response.body !== 'string' || !String(type ?? '').includes('text/html')) return
    const https = getConfig().baseUrl.protocol === 'https:'
    response.headers = { ...response.headers, 'content-security-policy': pageCsp({ scriptHashes: inlineScriptHashes(response.body), https }) }
  })
})
