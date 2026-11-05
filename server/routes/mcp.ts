import { getGateway } from '../mcp/runtime'

/**
 * /mcp (Plan 0b, Aufgabe 7). Alle Methoden gehen an das Gateway (Gate: Origin -> Methode -> Token -> MCP);
 * GET/DELETE beantwortet es mit 405 (zustandslos).
 * Spike (h3 1.15.11, Nitro 2.13): Eine Web-`Response` (auch gestreamt, `subscriptions/listen`) darf direkt aus dem
 * Handler zurueckgegeben werden (h3 schreibt den Body per `sendWebResponse` chunkweise). `toWebRequest(event)` traegt
 * KEIN `signal`: wir koppeln das Schliessen der Verbindung selbst an ein AbortSignal (HTTP-Abbruch = Stream schliessen).
 */
export default defineEventHandler(async (event) => {
  const ac = new AbortController()
  event.node.res.once('close', () => ac.abort())
  const request = new Request(toWebRequest(event), { signal: ac.signal })
  return (await getGateway()).handle(request)
})
