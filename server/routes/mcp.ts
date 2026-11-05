import { getGateway } from '../mcp/runtime'

/**
 * /mcp (plan 0b, task 7). All methods go to the gateway (gate: Origin -> method -> token -> MCP);
 * GET/DELETE it answers with 405 (stateless).
 * Spike (h3 1.15.11, Nitro 2.13): a web `Response` (also streamed, `subscriptions/listen`) may be returned directly from the
 * handler (h3 writes the body chunk by chunk via `sendWebResponse`). `toWebRequest(event)` carries
 * NO `signal`: we couple closing the connection to an AbortSignal ourselves (HTTP abort = close the stream).
 */
export default defineEventHandler(async (event) => {
  const ac = new AbortController()
  event.node.res.once('close', () => ac.abort())
  const request = new Request(toWebRequest(event), { signal: ac.signal })
  return (await getGateway()).handle(request)
})
