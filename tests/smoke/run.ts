// `pnpm smoke`: full-stack smoke as a script.
//  - without environment: starts the built artifact (`pnpm build`) on a fresh PGlite instance (TEST_BACKEND=postgres: Postgres)
//  - SMOKE_BASE_URL=...: runs against an existing, FRESH server (e.g. the container in the compose smoke);
//    then SMOKE_FAKE_URL (address of the fake MCP from the server's point of view; host = SMOKE_FAKE_HOST) and SMOKE_SSRF_ALLOW must be set.
import { startFakeHttp } from '../fixtures/fake-upstream/http'
import { createInstance, startServer } from '../integration/harness'
import { smokeSteps } from './flow'

const external = process.env.SMOKE_BASE_URL
const fake = await startFakeHttp({ host: process.env.SMOKE_FAKE_LISTEN ?? '127.0.0.1' })
let stop: () => Promise<void> = async () => {}
let baseUrl: string
let fakeUrl = fake.url
let ssrfAllow = ['127.0.0.0/8']
if (external) {
  baseUrl = external.replace(/\/$/, '')
  const host = process.env.SMOKE_FAKE_HOST
  if (!host) throw new Error('SMOKE_FAKE_HOST missing (address under which the server reaches the fake MCP)')
  fakeUrl = `http://${host}:${fake.port}/mcp`
  ssrfAllow = (process.env.SMOKE_SSRF_ALLOW ?? `${host}/32`).split(',')
} else {
  const inst = await createInstance()
  const srv = await startServer(inst)
  baseUrl = srv.url
  stop = async () => { await srv.stop(); await inst.cleanup() }
}

let failed = 0
try {
  for (const s of smokeSteps({ baseUrl, fake: { url: fakeUrl, state: fake.state }, ssrfAllow })) {
    const t0 = Date.now()
    try {
      await s.run()
      console.log(`ok   ${s.name} (${Date.now() - t0} ms)`)
    } catch (e) {
      failed++
      console.error(`FAIL ${s.name}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
      break // the steps build on each other
    }
  }
} finally {
  await fake.close()
  await stop()
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK')
process.exit(failed ? 1 : 0)
