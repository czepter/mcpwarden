import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import RestToolsEditor from '~/components/upstreams/RestToolsEditor.vue'
import type { RestToolInput } from '#shared/api-types'

function host(initial: RestToolInput[]) {
  const value = ref<RestToolInput[]>(initial)
  const Host = defineComponent({ setup: () => () => h(RestToolsEditor, { 'modelValue': value.value, 'slug': 'api', 'onUpdate:modelValue': (v: RestToolInput[]) => (value.value = v) }) })
  return { value, wrapper: mount(Host, { attachTo: document.body }) }
}

describe('RestToolsEditor', () => {
  it('shows the empty hint and adds a tool', async () => {
    const { wrapper, value } = host([])
    expect(wrapper.find('[data-testid="rest-empty"]').exists()).toBe(true)
    await wrapper.find('[data-testid="rest-add-tool"]').trigger('click')
    expect(wrapper.findAll('[data-testid="rest-tool"]')).toHaveLength(1)
    expect(value.value).toEqual([expect.objectContaining({ name: '', method: 'GET', inputSchema: { type: 'object', properties: {} }, headers: {}, bodyTemplate: null })])
    wrapper.unmount()
  })

  it('turns parameter rows into a JSON schema, keeps schema details it cannot edit, and drops removed rows', async () => {
    const { wrapper, value } = host([{ name: 'list', method: 'GET', urlTemplate: '/items?state={state}', inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['open', 'closed'], description: 'Status' } }, required: ['state'] } }])
    await wrapper.find('input[aria-label^="Name"]').setValue('status')
    await wrapper.vm.$nextTick()
    const schema = value.value[0]!.inputSchema as { properties: Record<string, Record<string, unknown>>, required: string[] }
    expect(schema.properties.status).toEqual({ type: 'string', enum: ['open', 'closed'], description: 'Status' })
    expect(schema.required).toEqual(['status'])
    await wrapper.find('button[aria-label^="Parameter 1 entfernen"]').trigger('click')
    expect((value.value[0]!.inputSchema as { properties: object }).properties).toEqual({})
    wrapper.unmount()
  })

  it('offers to add parameters for placeholders that have none; path placeholders become required', async () => {
    const { wrapper, value } = host([{ name: 'get', urlTemplate: '/items/{id}?q={q}' }])
    const note = wrapper.find('[data-testid="rest-missing"]')
    expect(note.text()).toContain('id'); expect(note.text()).toContain('q')
    await wrapper.findAll('button').find(b => b.text() === 'Parameter ergänzen')!.trigger('click')
    const s = value.value[0]!.inputSchema as { properties: Record<string, unknown>, required: string[] }
    expect(Object.keys(s.properties)).toEqual(['id', 'q'])
    expect(s.required).toEqual(['id'])
    expect(wrapper.find('[data-testid="rest-missing"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('parses headers and drops the body template for GET', async () => {
    const { wrapper, value } = host([{ name: 'post', method: 'POST', urlTemplate: 'https://api.example.com/x', headers: { 'X-Tenant': 'acme' }, bodyTemplate: '{"a":1}' }])
    expect(value.value[0]).toMatchObject({ headers: { 'X-Tenant': 'acme' }, bodyTemplate: '{"a":1}' })
    await wrapper.find('select').setValue('GET')
    expect(value.value[0]!.bodyTemplate).toBeNull()
    wrapper.unmount()
  })
})
