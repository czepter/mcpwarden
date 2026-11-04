import { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

/** Steuerbarer Zustand des Fake-Upstreams (im Testprozess direkt manipulierbar). */
export type FakeState = {
  calls: Record<string, number>
  cancelled: number
  aborted: number // Verbindungen, die vor der Antwort geschlossen wurden
  mode: 'ok' | 'hang' | 'status500' | 'hang-http'
  slowMs: number
  extraTools: Array<{ name: string, description?: string }>
  requests: Array<{ method: string, headers: Record<string, string | string[] | undefined> }>
}
export const newState = (): FakeState => ({ calls: {}, cancelled: 0, aborted: 0, mode: 'ok', slowMs: 0, extraTools: [], requests: [] })

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res) => {
  const t = setTimeout(res, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); res() }, { once: true })
})

export function buildFakeServer(state: FakeState, extra: { toolNames?: string[] } = {}): McpServer {
  const s = new McpServer({ name: 'fake-upstream', version: '1.0.0' })
  const count = (n: string) => { state.calls[n] = (state.calls[n] ?? 0) + 1 }
  const gate = async (signal: AbortSignal) => {
    if (state.mode === 'hang') await new Promise<void>(res => signal.addEventListener('abort', () => res(), { once: true }))
    else if (state.slowMs) await sleep(state.slowMs, signal)
  }
  s.registerTool('echo', { description: 'Echo text', inputSchema: z.object({ text: z.string() }), annotations: { readOnlyHint: true } },
    async ({ text }, ctx) => { count('echo'); await gate(ctx.mcpReq.signal); return { content: [{ type: 'text', text }] } })
  s.registerTool('add', { description: 'Add', inputSchema: z.object({ a: z.number(), b: z.number() }) },
    async ({ a, b }) => { count('add'); return { content: [{ type: 'text', text: String(a + b) }], structuredContent: { sum: a + b } } })
  s.registerTool('image', { description: 'Image' }, async () => { count('image'); return { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] } })
  s.registerTool('resource', { description: 'Resource' }, async () => {
    count('resource')
    return { content: [{ type: 'resource', resource: { uri: 'file:///x.txt', mimeType: 'text/plain', text: 'hi' } }] }
  })
  s.registerTool('fail', { description: 'Tool error' }, async () => { count('fail'); return { isError: true, content: [{ type: 'text', text: 'boom' }] } })
  // nicht-idempotent: jeder Aufruf erhöht den Zähler; bei hang/status500 darf er nie doppelt laufen
  s.registerTool('create_order', { description: 'Non-idempotent', inputSchema: z.object({}) },
    async (_a, ctx) => { count('create_order'); await gate(ctx.mcpReq.signal); return { content: [{ type: 'text', text: `order-${state.calls.create_order}` }] } })
  for (const t of [...state.extraTools, ...(extra.toolNames ?? []).map(name => ({ name }))]) {
    s.registerTool(t.name, { description: t.description ?? t.name }, async () => { count(t.name); return { content: [{ type: 'text', text: t.name }] } })
  }
  return s
}
