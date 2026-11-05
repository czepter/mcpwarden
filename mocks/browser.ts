import { setupWorker } from 'msw/browser'
import { handlersFor, resetState } from './index'

export async function startMock(spec: string) {
  const worker = setupWorker(...handlersFor(spec))
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true })
  ;(window as unknown as { __mock: unknown }).__mock = { reset: () => { resetState(); location.reload() } }
}
