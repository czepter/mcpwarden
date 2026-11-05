import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { startFakeHttp, type FakeHttp } from '../fixtures/fake-upstream/http'

let fake: FakeHttp
beforeAll(async () => { fake = await startFakeHttp() })
afterAll(() => fake.close())

describe('sdk v2 against fake upstream', () => {
  it('connect, list, call', async () => {
    const c = new Client({ name: 't', version: '1' })
    await c.connect(new StreamableHTTPClientTransport(new URL(fake.url)))
    const tools = await c.listTools()
    expect(tools.tools.map(t => t.name)).toContain('echo')
    const r = await c.callTool({ name: 'echo', arguments: { text: 'hi' } })
    expect(r.content).toEqual([{ type: 'text', text: 'hi' }])
    await c.close()
  })
})
