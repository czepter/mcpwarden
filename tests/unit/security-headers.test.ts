import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { API_CSP, baseSecurityHeaders, inlineScriptHashes, isApiPath, pageCsp } from '../../server/utils/security-headers'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64')

describe('inlineScriptHashes', () => {
  it('hashes executable inline scripts only', () => {
    const html = [
      '<script>window.__NUXT__={}</script>',
      '<script type="module">import("/x.js")</script>',
      '<script type="application/json" id="__NUXT_DATA__">[1,2]</script>',
      '<script src="/_nuxt/entry.js" type="module"></script>',
      '<SCRIPT TYPE=\'text/javascript\'>var a=1</SCRIPT >',
    ].join('')
    expect(inlineScriptHashes(html).sort()).toEqual([sha('window.__NUXT__={}'), sha('import("/x.js")'), sha('var a=1')].sort())
  })
  it('hashes the exact text (whitespace matters) and de-duplicates', () => {
    expect(inlineScriptHashes('<script> a </script><script> a </script>')).toEqual([sha(' a ')])
  })
  it('a script whose body contains "</scr" text inside a string still ends at the first closing tag', () => {
    expect(inlineScriptHashes('<script>var s="x"</script><p>y</p>')).toEqual([sha('var s="x"')])
  })
})

describe('pageCsp', () => {
  const csp = pageCsp({ scriptHashes: ['AAA='], https: true })
  it('allows only same-origin scripts plus the given hashes, never unsafe-inline/eval for scripts', () => {
    const script = csp.split('; ').find(d => d.startsWith('script-src'))!
    expect(script).toBe("script-src 'self' 'sha256-AAA='")
    expect(script).not.toMatch(/unsafe/)
  })
  it('forbids framing, plugins and foreign base/form targets', () => {
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-src 'none'", "default-src 'self'", "connect-src 'self'"]) expect(csp).toContain(d)
  })
  it('upgrades insecure requests only on https', () => {
    expect(csp).toContain('upgrade-insecure-requests')
    expect(pageCsp({ scriptHashes: [], https: false })).not.toContain('upgrade-insecure-requests')
  })
})

describe('baseSecurityHeaders / API csp', () => {
  it('sets nosniff, frame denial and same-origin referrer; HSTS only on https', () => {
    const h = baseSecurityHeaders({ https: false })
    expect(h).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' })
    expect(h['strict-transport-security']).toBeUndefined()
    expect(baseSecurityHeaders({ https: true })['strict-transport-security']).toMatch(/max-age=\d+/)
  })
  it('classifies data paths', () => {
    for (const p of ['/api/me', '/mcp', '/.well-known/oauth-protected-resource', '/healthz', '/readyz']) expect(isApiPath(p)).toBe(true)
    for (const p of ['/', '/login', '/consent', '/_nuxt/a.js']) expect(isApiPath(p)).toBe(false)
    expect(API_CSP).toContain("default-src 'none'")
    expect(API_CSP).toContain("frame-ancestors 'none'")
  })
})
