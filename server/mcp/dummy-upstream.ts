/** Dummy-Upstream `dummy` (Plan 0b, Aufgabe 7). Echo-Tools fuer den Durchstich, wird in Phase 1 ersetzt. */
import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { AuthContext } from '../auth/auth-context'
import type { ToolDef, ToolSource } from './upstream-port'

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) })

const tools: Record<string, { def: Omit<ToolDef, 'name'>, hidable: boolean }> = {
  dummy__echo: { hidable: true, def: { description: 'Gibt den Text zurueck.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  dummy__add: { hidable: true, def: { description: 'Addiert zwei Zahlen.', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } } },
  dummy__whoami: { hidable: false, def: { description: 'Zeigt Nutzer, Rolle, Token-Typ und Scopes.', inputSchema: { type: 'object', properties: {} } } },
  dummy__slow_echo: { hidable: false, def: { description: 'Antwortet nach ms Millisekunden, abbrechbar.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, ms: { type: 'number' } }, required: ['text'] } } },
  dummy__toggle_tool: { hidable: false, def: { description: 'Blendet dummy__echo aus/ein und meldet list_changed.', inputSchema: { type: 'object', properties: {} } } },
}

const echoArgs = z.object({ text: z.string() })
const addArgs = z.object({ a: z.number(), b: z.number() })
const slowArgs = z.object({ text: z.string(), ms: z.number().min(0).max(60_000).default(5000) })

/** `notify` meldet list_changed nur fuer den uebergebenen Nutzer. `onAbort` ist ein Testhaken. */
export function createDummyUpstream(opts: { notify: (userId: string) => void, onAbort?: (name: string) => void }): ToolSource {
  const hiddenFor = new Set<string>() // userId -> dummy__echo ausgeblendet

  return {
    async listTools(ctx) {
      return Object.entries(tools)
        .filter(([name]) => !(name === 'dummy__echo' && hiddenFor.has(ctx.userId)))
        .map(([name, t]) => ({ name, ...t.def }))
    },
    async callTool(ctx: AuthContext, name, args, { signal }) {
      if (!(name in tools) || (name === 'dummy__echo' && hiddenFor.has(ctx.userId))) return text(`unknown tool: ${name}`, true)
      switch (name) {
        case 'dummy__echo': {
          const p = echoArgs.safeParse(args)
          return p.success ? text(p.data.text) : text(`invalid arguments: ${p.error.message}`, true)
        }
        case 'dummy__add': {
          const p = addArgs.safeParse(args)
          return p.success ? text(String(p.data.a + p.data.b)) : text(`invalid arguments: ${p.error.message}`, true)
        }
        case 'dummy__whoami':
          return text(JSON.stringify({ userId: ctx.userId, role: ctx.role, tokenType: ctx.tokenType, scopes: ctx.scopes }))
        case 'dummy__slow_echo': {
          const p = slowArgs.safeParse(args)
          if (!p.success) return text(`invalid arguments: ${p.error.message}`, true)
          return await new Promise<CallToolResult>((resolve) => {
            const timer = setTimeout(() => resolve(text(p.data.text)), p.data.ms)
            const abort = () => { clearTimeout(timer); opts.onAbort?.(name); resolve(text('aborted', true)) }
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
          })
        }
        default: { // dummy__toggle_tool
          if (hiddenFor.delete(ctx.userId)) { /* wieder sichtbar */ } else hiddenFor.add(ctx.userId)
          opts.notify(ctx.userId)
          return text(hiddenFor.has(ctx.userId) ? 'dummy__echo hidden' : 'dummy__echo visible')
        }
      }
    },
  }
}
