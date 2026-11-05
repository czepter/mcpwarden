// `pnpm smoke`: Full-Stack-Smoke als Skript.
//  - ohne Umgebung: startet das gebaute Artefakt (`pnpm build`) auf einer frischen PGlite-Instanz (TEST_BACKEND=postgres: Postgres)
//  - SMOKE_BASE_URL=...: laeuft gegen einen vorhandenen, FRISCHEN Server (z. B. den Container im Compose-Smoke);
//    dann muessen SMOKE_FAKE_URL (Adresse des Fake-MCP aus Sicht des Servers; Host = SMOKE_FAKE_HOST) und SMOKE_SSRF_ALLOW gesetzt sein.
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
  if (!host) throw new Error('SMOKE_FAKE_HOST fehlt (Adresse, unter der der Server das Fake-MCP erreicht)')
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
      break // die Schritte bauen aufeinander auf
    }
  }
} finally {
  await fake.close()
  await stop()
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK')
process.exit(failed ? 1 : 0)
