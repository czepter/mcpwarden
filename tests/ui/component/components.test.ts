import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import OneTimeSecret from '~/components/common/OneTimeSecret.vue'
import SecretField from '~/components/common/SecretField.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import SparkBars from '~/components/common/SparkBars.vue'
import ToolTable from '~/components/upstreams/ToolTable.vue'
import type { UpstreamTool } from '#shared/api-types'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('StatusBadge', () => {
  it.each(['healthy', 'degraded', 'open', 'auth_expired', 'disabled', 'unknown'])('zeigt Text neben dem Punkt: %s', (s) => {
    const w = mount(StatusBadge, { props: { status: s } })
    expect(w.text().length).toBeGreaterThan(3)
    expect(w.find('[aria-hidden="true"]').exists()).toBe(true)
  })
  it('Wartezustand hat Vorrang', () => {
    expect(mount(StatusBadge, { props: { status: 'healthy', setup: 'awaiting_approval' } }).text()).toBe('Wartet auf Freigabe')
  })
})

describe('SecretField', () => {
  it('maskiert, zeigt nur auf Wunsch und leert den Wert beim Verlassen', async () => {
    const value = ref('geheim')
    const Host = defineComponent({ setup: () => () => h(SecretField, { 'modelValue': value.value, 'onUpdate:modelValue': (v: string) => (value.value = v) }) })
    const wrapper = mount(Host, { attachTo: document.body })
    const input = wrapper.find('input')
    expect(input.attributes('type')).toBe('password')
    expect(input.attributes('autocomplete')).toBe('new-password')
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('input').attributes('type')).toBe('text')
    wrapper.unmount()
    expect(value.value).toBe('')
  })
})

describe('OneTimeSecret', () => {
  it('zeigt den Wert, Hinweis "nur einmal" und meldet Schliessen', async () => {
    const w = mount(OneTimeSecret, { props: { title: 'Token erzeugt', value: 'mcpw_pat_abc' } })
    expect(w.attributes('role')).toBe('status')
    expect(w.text()).toContain('mcpw_pat_abc')
    expect(w.text()).toContain('nur jetzt')
    await w.findAll('button').at(-1)!.trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})

describe('SparkBars', () => {
  it('hat eine Textalternative', () => {
    const w = mount(SparkBars, { props: { items: ['ok', 'ok', 'err'] } })
    expect(w.find('.sr-only').text()).toBe('Letzte 3 Einträge: 2 ohne Fehler, 1 mit Fehlern')
  })
})

describe('ToolTable', () => {
  const tool = (name: string): UpstreamTool => ({ name, title: null, description: '<b>x</b>', enabled: false, gone: false, firstSeenAt: '', lastSeenAt: '', annotations: { readOnlyHint: true } })
  it('Schalter wirkt optimistisch und wird bei Fehler zurueckgenommen', async () => {
    const save = vi.fn().mockRejectedValue(new Error('x'))
    const w = mount(ToolTable, { props: { tools: [tool('list_issues')], save }, attachTo: document.body })
    const sw = () => w.find('button[role="switch"]')
    expect(sw().attributes('aria-checked')).toBe('false')
    await sw().trigger('click')
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('list_issues', true))
    await vi.waitFor(() => expect(sw().attributes('aria-checked')).toBe('false'))
  })
  it('rendert Beschreibungen nur als Text', () => {
    const w = mount(ToolTable, { props: { tools: [tool('a')], save: vi.fn() } })
    expect(w.find('b').exists()).toBe(false)
    expect(w.text()).toContain('<b>x</b>')
  })
})
