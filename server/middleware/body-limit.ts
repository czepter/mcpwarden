import { apiError } from '../utils/api'
import { bodyLimitViolation } from '../utils/body-limit'

// Runs before csrf.ts (alphabetical): oversized or length-less bodies are rejected before any handler buffers them.
export default defineEventHandler((event) => {
  const h = event.node.req.headers
  const v = bodyLimitViolation({
    method: event.method,
    path: event.path.split('?')[0]!,
    contentLength: h['content-length'] as string | undefined,
    transferEncoding: h['transfer-encoding'] as string | undefined,
  })
  if (v === 413) throw apiError(413, 'payload_too_large', 'Anfrage zu groß')
  if (v === 411) throw apiError(411, 'length_required', 'Content-Length fehlt')
})
