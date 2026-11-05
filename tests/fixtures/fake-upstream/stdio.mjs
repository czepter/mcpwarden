// Fake-stdio-MCP-Server (Testfixture). Marker-Datei (FAKE_MARK) protokolliert Abbrüche und Aufrufe.
import { appendFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

const mark = (s) => { if (process.env.FAKE_MARK) appendFileSync(process.env.FAKE_MARK, s + '\n') }
const s = new McpServer({ name: 'fake-stdio', version: '1.0.0' })
s.registerTool('echo', { description: 'Echo', inputSchema: z.object({ text: z.string() }) }, async ({ text }) => ({ content: [{ type: 'text', text }] }))
s.registerTool('env', { description: 'Env' }, async () => ({ content: [{ type: 'text', text: JSON.stringify(process.env) }] }))
s.registerTool('create_order', { description: 'Non-idempotent' }, async () => { mark('create_order'); return { content: [{ type: 'text', text: 'ok' }] } })
s.registerTool('hang', { description: 'Hangs until cancelled' }, async (_a, ctx) => {
  mark('hang-start')
  await new Promise((res) => ctx.mcpReq.signal.addEventListener('abort', res, { once: true }))
  mark('hang-cancelled')
  return { content: [{ type: 'text', text: 'cancelled' }] }
})
s.registerTool('die', { description: 'Exits mid-call' }, async () => { process.exit(3) })
await s.connect(new StdioServerTransport())
