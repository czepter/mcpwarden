import { describe, expect, it } from 'vitest'
import { checkRestTool, checkRestTools, renderRequest, RestToolError } from '../../server/gateway/rest/template'

const tool = (o: Record<string, unknown> = {}) => checkRestTool({
  name: 'get_item', method: 'GET', urlTemplate: 'https://api.example.com/items/{id}',
  inputSchema: { type: 'object', properties: { id: { type: 'string' }, q: { type: 'string' } }, required: ['id'] }, ...o,
}, false)
const render = (t: ReturnType<typeof tool>, args: Record<string, unknown>, baseUrl: string | null = null) => renderRequest({ tool: t, baseUrl, args })
const err = (fn: () => unknown) => { try { fn() } catch (e) { return e instanceof RestToolError ? e.message : String(e) } return null }

describe('REST tool validation', () => {
  it('accepts a minimal definition and fills defaults', () => {
    const t = checkRestTool({ name: 'ping', urlTemplate: 'https://api.example.com/ping' }, false)
    expect(t).toMatchObject({ method: 'GET', enabled: true, headers: {}, bodyTemplate: null, inputSchema: { type: 'object', properties: {} } })
  })
  it('rejects bad names, methods and URLs', () => {
    expect(err(() => checkRestTool({ name: 'a b', urlTemplate: 'https://x.test/' }, false))).toMatch(/Toolname/)
    expect(err(() => checkRestTool({ name: 'a', method: 'TRACE', urlTemplate: 'https://x.test/' }, false))).toMatch(/method/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'ftp://x.test/' }, true))).toMatch(/urlTemplate/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: '//evil.test/x' }, true))).toMatch(/urlTemplate/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: '/relative' }, false))).toMatch(/Basis-URL/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://user@x.test/' }, false))).toMatch(/Zugangsdaten/)
  })
  it('refuses placeholders in scheme/host', () => {
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://{host}/x', inputSchema: { properties: { host: { type: 'string' } }, required: ['host'] } }, false))).toMatch(/Host/)
  })
  it('placeholders must be declared; path placeholders must be required', () => {
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://x.test/{nope}' }, false))).toMatch(/kein Parameter/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://x.test/{id}', inputSchema: { properties: { id: { type: 'string' } } } }, false))).toMatch(/required/)
  })
  it('refuses auth/framing headers, bad values and bodies on GET', () => {
    for (const h of ['Authorization', 'Host', 'Content-Length', 'Cookie', 'Proxy-Foo']) expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://x.test/', headers: { [h]: 'x' } }, false))).toMatch(/nicht erlaubt/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://x.test/', headers: { 'X-A': 'a\r\nb' } }, false))).toMatch(/Wert/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://x.test/', bodyTemplate: '{}' }, false))).toMatch(/kennt keinen Body/)
    expect(err(() => checkRestTool({ name: 'a', method: 'POST', urlTemplate: 'https://x.test/', bodyTemplate: '{nope' }, false))).toMatch(/JSON/)
  })
  it('schema: required must name existing properties; property types are checked', () => {
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://x.test/', inputSchema: { properties: {}, required: ['x'] } }, false))).toMatch(/required/)
    expect(err(() => checkRestTool({ name: 'a', urlTemplate: 'https://x.test/', inputSchema: { properties: { x: { type: 'date' } } } }, false))).toMatch(/Typ/)
  })
  it('list: duplicate names and the size limit', () => {
    expect(err(() => checkRestTools([{ name: 'a', urlTemplate: 'https://x.test/' }, { name: 'a', urlTemplate: 'https://x.test/' }], false))).toMatch(/doppelt/)
    expect(err(() => checkRestTools(Array.from({ length: 51 }, (_, i) => ({ name: `t${i}`, urlTemplate: 'https://x.test/' })), false))).toMatch(/Höchstens/)
  })
})

describe('REST request rendering', () => {
  it('percent-encodes path and query values', () => {
    const t = tool({ urlTemplate: 'https://api.example.com/items/{id}?q={q}' })
    expect(render(t, { id: 'a/b c', q: 'x&y=z' }).url).toBe('https://api.example.com/items/a%2Fb%20c?q=x%26y%3Dz')
  })
  it('drops an optional query pair that is not supplied, but a missing path value is an error', () => {
    const t = tool({ urlTemplate: 'https://api.example.com/items/{id}?q={q}' })
    expect(render(t, { id: '1' }).url).toBe('https://api.example.com/items/1')
    expect(err(() => render(t, {}))).toMatch(/fehlt/)
  })
  it('cannot change host, scheme or climb out of the path through values', () => {
    const t = tool()
    for (const evil of ['@evil.test', '//evil.test', 'https://evil.test', '..', '.', '../../x', '\\\\evil']) {
      let url: string | null = null
      const e = err(() => { url = render(t, { id: evil }).url })
      if (url) { expect(new URL(url).host).toBe('api.example.com'); expect(new URL(url).pathname.startsWith('/items/')).toBe(true) } else expect(e).toBeTruthy()
    }
  })
  it('relative templates are appended to the base URL path and keep its origin', () => {
    const t = checkRestTool({ name: 'a', urlTemplate: '/items/{id}', inputSchema: { properties: { id: { type: 'string' } }, required: ['id'] } }, true)
    expect(render(t, { id: '7' }, 'https://api.example.com/v1/').url).toBe('https://api.example.com/v1/items/7')
    expect(err(() => render(t, { id: '7' }, null))).toMatch(/Basis-URL/)
  })
  it('unreferenced arguments: query for GET, JSON body for POST', () => {
    const get = tool({ urlTemplate: 'https://api.example.com/search', inputSchema: { properties: { id: { type: 'string' }, tags: { type: 'array' }, n: { type: 'integer' } }, required: [] } })
    expect(render(get, { n: 3, tags: ['a', 'b'] }).url).toBe('https://api.example.com/search?n=3&tags=a&tags=b')
    const post = tool({ method: 'POST', urlTemplate: 'https://api.example.com/items', inputSchema: { properties: { title: { type: 'string' }, n: { type: 'integer' } }, required: ['title'] } })
    const r = render(post, { title: 'x', n: 2 })
    expect(r.body).toBe('{"title":"x","n":2}')
    expect(r.headers['Content-Type']).toBe('application/json')
  })
  it('body template: whole-string placeholders keep their type, embedded ones interpolate', () => {
    const t = tool({ method: 'POST', urlTemplate: 'https://api.example.com/items', bodyTemplate: '{"count":"{n}","label":"item {id}","tags":["{id}"]}', inputSchema: { properties: { n: { type: 'integer' }, id: { type: 'string' } }, required: ['n', 'id'] } })
    expect(JSON.parse(render(t, { n: 4, id: 'z' }).body!)).toEqual({ count: 4, label: 'item z', tags: ['z'] })
  })
  it('header placeholders are filled; injected line breaks are refused', () => {
    const t = tool({ headers: { 'X-Tenant': '{tenant}' }, inputSchema: { properties: { id: { type: 'string' }, tenant: { type: 'string' } }, required: ['id', 'tenant'] } })
    expect(render(t, { id: '1', tenant: 'acme' }).headers['X-Tenant']).toBe('acme')
    expect(err(() => render(t, { id: '1', tenant: 'a\r\nHost: evil' }))).toMatch(/unzulässig/)
  })
  it('arguments are checked: required, unknown, type, enum', () => {
    const t = tool({ inputSchema: { properties: { id: { type: 'integer' }, mode: { type: 'string', enum: ['a', 'b'] } }, required: ['id'] }, urlTemplate: 'https://api.example.com/items/{id}?mode={mode}' })
    expect(err(() => render(t, {}))).toMatch(/fehlt/)
    expect(err(() => render(t, { id: 'x' }))).toMatch(/integer/)
    expect(err(() => render(t, { id: 1, other: 1 }))).toMatch(/Unbekannt/)
    expect(err(() => render(t, { id: 1, mode: 'c' }))).toMatch(/nicht erlaubt/)
  })
})
