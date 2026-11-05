// Full-Stack-Smoke gegen das gebaute Artefakt (PGlite oder Postgres je TEST_BACKEND): ein Server, ein Fake-MCP-Upstream im
// Testprozess, alles nur ueber HTTP. Die Schritte stehen in tests/smoke/flow.ts und laufen hier der Reihe nach.
import { afterAll, beforeAll, describe, it } from 'vitest'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'
import { smokeSteps } from '../smoke/flow'
import { backend, createInstance, startServer, type TestInstance, type TestServer } from './harness'

let inst: TestInstance
let srv: TestServer
let fake: FakeHttp

beforeAll(async () => {
  inst = await createInstance()
  srv = await startServer(inst)
  fake = await startFakeHttp()
})
afterAll(async () => {
  await srv?.stop()
  await fake?.close()
  await inst?.cleanup()
})

describe(`full-stack smoke (${backend})`, () => {
  // Die Schritte bauen aufeinander auf: der Server existiert erst nach beforeAll, daher die Liste lazy erzeugen.
  const names = smokeSteps({ baseUrl: 'http://placeholder', fake: { url: '', state: undefined as never }, ssrfAllow: [] }).map(s => s.name)
  let steps: ReturnType<typeof smokeSteps>
  names.forEach((name, i) => {
    it(name, async () => {
      steps ??= smokeSteps({ baseUrl: srv.url, fake: { url: fake.url, state: fake.state }, ssrfAllow: ['127.0.0.0/8'] })
      await steps[i]!.run()
    })
  })
})
