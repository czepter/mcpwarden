// Full-stack smoke against the built artifact (PGlite or Postgres per TEST_BACKEND): one server, one fake MCP upstream in the
// test process, everything over HTTP only. The steps are in tests/smoke/flow.ts and run here one after another.
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
  // The steps build on each other: the server exists only after beforeAll, hence create the list lazily.
  const names = smokeSteps({ baseUrl: 'http://placeholder', fake: { url: '', state: undefined as never }, ssrfAllow: [] }).map(s => s.name)
  let steps: ReturnType<typeof smokeSteps>
  names.forEach((name, i) => {
    it(name, async () => {
      steps ??= smokeSteps({ baseUrl: srv.url, fake: { url: fake.url, state: fake.state }, ssrfAllow: ['127.0.0.0/8'] })
      await steps[i]!.run()
    })
  })
})
