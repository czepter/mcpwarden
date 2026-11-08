import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { ToolMode } from '../../shared/api-types'
import { ToolNotFoundError } from '../../server/gateway/ports'
import { createGateway } from '../../server/mcp/handler'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { ctxFor, makeGateway, sig } from '../helpers/gateway'

let a: FakeHttp, b: FakeHttp
beforeAll(async () => { a = await startFakeHttp(); b = await startFakeHttp({ toolNames: ['only_b'] }) })
afterAll(async () => { await a.close(); await b.close() })
const text = (r: { content?: unknown }) => (r.content as Array<{ text?: string }>)[0]?.text ?? ''

describe('meta-tool mode', () => {
  let h: ReturnType<typeof makeGateway>
  const modes = new Map<string, ToolMode>()
  const mk = () => (h = makeGateway({ getToolMode: async u => modes.get(u) ?? 'direct', statsRead: async () => ({}) as never }))
  afterEach(async () => { modes.clear(); await h.gw.shutdown(500) })

  it('direct mode: full catalog, meta tools do not exist', async () => {
    mk(); h.store.addUpstream('A', { slug: 'one', url: a.url })
    const ctx = ctxFor('A')
    const names = (await h.gw.toolSource.listTools(ctx)).map(t => t.name)
    expect(names).toContain('one__echo')
    expect(names).not.toContain('find_tools')
    await expect(h.gw.toolSource.callTool(ctx, 'find_tools', { query: 'echo' }, { signal: sig() })).rejects.toBeInstanceOf(ToolNotFoundError)
  })

  it('meta mode: list is only the three meta tools plus get_stats, no upstream is contacted for it', async () => {
    mk(); h.store.addUpstream('A', { slug: 'one', url: a.url }); modes.set('A', 'meta')
    const names = (await h.gw.toolSource.listTools(ctxFor('A'))).map(t => t.name)
    expect(names).toEqual(['find_tools', 'describe_tool', 'invoke_tool', 'get_stats'])
    expect(h.gw.pool.count()).toBe(0)
  })

  it('find_tools ranks candidates, describe_tool returns the schema, invoke_tool calls through', async () => {
    mk(); h.store.addUpstream('A', { slug: 'one', url: a.url }); modes.set('A', 'meta')
    const ctx = ctxFor('A')
    const found = JSON.parse(text(await h.gw.toolSource.callTool(ctx, 'find_tools', { query: 'add numbers' }, { signal: sig() })))
    expect(found.candidates.map((c: { name: string }) => c.name)).toContain('one__add')
    const def = JSON.parse(text(await h.gw.toolSource.callTool(ctx, 'describe_tool', { name: 'one__add' }, { signal: sig() })))
    expect(def.name).toBe('one__add'); expect(def.inputSchema).toBeTruthy()
    const res = await h.gw.toolSource.callTool(ctx, 'invoke_tool', { name: 'one__add', arguments: { a: 2, b: 3 } }, { signal: sig() })
    expect(res.structuredContent).toEqual({ sum: 5 })
  })

  it('invoke_tool re-checks on every call: guessed, disabled, foreign, restricted and meta names are rejected', async () => {
    mk()
    const up = h.store.addUpstream('A', { slug: 'one', url: a.url })
    h.store.addUpstream('B', { slug: 'one', url: b.url })
    modes.set('A', 'meta'); modes.set('B', 'meta')
    const ctx = ctxFor('A')
    const inv = (c: typeof ctx, name: string) => h.gw.toolSource.callTool(c, 'invoke_tool', { name, arguments: { text: 'x' } }, { signal: sig() })
    await inv(ctx, 'one__echo') // warms the catalog
    await expect(inv(ctx, 'one__guessed')).rejects.toBeInstanceOf(ToolNotFoundError)
    await expect(inv(ctx, 'nonexistent__echo')).rejects.toBeInstanceOf(ToolNotFoundError)
    await expect(inv(ctx, 'find_tools')).rejects.toBeInstanceOf(ToolNotFoundError)
    // B has an own upstream with the same slug; A never reaches B's tool `only_b`
    await expect(inv(ctx, 'one__only_b')).rejects.toBeInstanceOf(ToolNotFoundError)
    expect(text(await inv(ctxFor('B'), 'one__only_b'))).toBeDefined()
    // token restricted to other upstreams
    await expect(inv(ctxFor('A', { upstreamIds: ['00000000-0000-0000-0000-000000000000'] }), 'one__echo')).rejects.toBeInstanceOf(ToolNotFoundError)
    // disabled afterwards: takes effect without restart, find/describe no longer show it either
    h.store.setToolEnabled('A', up.id, 'echo', false)
    await expect(inv(ctx, 'one__echo')).rejects.toBeInstanceOf(ToolNotFoundError)
    const found = JSON.parse(text(await h.gw.toolSource.callTool(ctx, 'find_tools', { query: 'echo' }, { signal: sig() })))
    expect(found.candidates.map((c: { name: string }) => c.name)).not.toContain('one__echo')
    const d = await h.gw.toolSource.callTool(ctx, 'describe_tool', { name: 'one__echo' }, { signal: sig() })
    expect(d.isError).toBe(true)
    up.enabled = false
    await expect(inv(ctx, 'one__add')).rejects.toBeInstanceOf(ToolNotFoundError)
  })

  it('validates arguments of the meta tools', async () => {
    mk(); h.store.addUpstream('A', { slug: 'one', url: a.url }); modes.set('A', 'meta')
    const ctx = ctxFor('A')
    const call = (n: string, args: Record<string, unknown>) => h.gw.toolSource.callTool(ctx, n, args, { signal: sig() })
    expect((await call('find_tools', {})).isError).toBe(true)
    expect((await call('find_tools', { query: 'x', limit: 0 })).isError).toBe(true)
    expect((await call('find_tools', { query: 'x', limit: 99 })).isError).toBe(true)
    expect((await call('describe_tool', {})).isError).toBe(true)
    expect((await call('invoke_tool', {})).isError).toBe(true)
    expect((await call('invoke_tool', { name: 'one__echo', arguments: 'x' })).isError).toBe(true)
  })

  it('measurement: routing steps are list rows (not calls), the invoked tool counts as a call against its upstream', async () => {
    mk(); h.store.addUpstream('A', { slug: 'one', url: a.url }); modes.set('A', 'meta')
    const ctx = ctxFor('A')
    await h.gw.toolSource.listTools(ctx)
    await h.gw.toolSource.callTool(ctx, 'find_tools', { query: 'echo' }, { signal: sig() })
    await h.gw.toolSource.callTool(ctx, 'invoke_tool', { name: 'one__echo', arguments: { text: 'x' } }, { signal: sig() })
    await h.gw.stats.stop()
    const route = h.rows.filter(r => r.upstreamSlug === 'mcpwarden')
    expect(route.map(r => [r.kind, r.tool])).toEqual(expect.arrayContaining([['list', null], ['list', 'find_tools'], ['list', 'invoke_tool']]))
    expect(h.rows.some(r => r.kind === 'call' && r.upstreamSlug === 'one' && r.tool === 'echo')).toBe(true)
    expect(h.rows.some(r => r.kind === 'call' && r.upstreamSlug === 'mcpwarden')).toBe(false)
  })

  it('over the /mcp handler: tools/list follows the mode, switching takes effect on the next request', async () => {
    mk(); h.store.addUpstream('A', { slug: 'one', url: a.url })
    const gateway = createGateway({
      tools: h.gw.toolSource,
      cfg: { baseUrl: new URL('http://127.0.0.1'), allowedOrigins: [] },
      authenticate: async () => ({ ctx: ctxFor('A'), token: 't' }),
    })
    let rpcLast: unknown
    const rpc = async (method: string, params: unknown = {}) => {
      const res = await gateway.handle(new Request('http://localhost/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', host: '127.0.0.1' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))
      const raw = await res.text(); rpcLast = [res.status, raw]
      return JSON.parse(raw.startsWith('event:') || raw.includes('\ndata:') || raw.startsWith('data:') ? raw.split('\n').find(l => l.startsWith('data:'))!.slice(5) : raw)
    }
    const names = async () => ((await rpc('tools/list')).result?.tools ?? (() => { throw new Error('rpc: ' + JSON.stringify(rpcLast)) })() as Array<{ name: string }>).map(t => t.name)
    expect(await names()).toContain('one__echo')
    modes.set('A', 'meta')
    expect(await names()).toEqual(['find_tools', 'describe_tool', 'invoke_tool', 'get_stats'])
    const call = await rpc('tools/call', { name: 'invoke_tool', arguments: { name: 'one__echo', arguments: { text: 'hi' } } })
    expect(call.result.content[0].text).toBe('hi')
    const bad = await rpc('tools/call', { name: 'invoke_tool', arguments: { name: 'one__guess', arguments: {} } })
    expect(bad.error ?? bad.result?.isError).toBeTruthy()
    modes.set('A', 'direct')
    expect(await names()).toContain('one__echo')
    await gateway.close()
  })
})
