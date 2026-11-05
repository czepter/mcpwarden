import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import OneTimeSecret from '~/components/common/OneTimeSecret.vue'
import SecretField from '~/components/common/SecretField.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import SparkBars from '~/components/common/SparkBars.vue'
import ToolTable from '~/components/upstreams/ToolTable.vue'
import type { UpstreamToolItem } from '#shared/api-types'

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('StatusBadge', () => {
  it.each(['healthy', 'degraded', 'open', 'auth_expired', 'disabled', 'unknown'])('shows text next to the dot: %s', (s) => {
    const w = mount(StatusBadge, { props: { status: s } })
    expect(w.text().length).toBeGreaterThan(3)
    expect(w.find('[aria-hidden="true"]').exists()).toBe(true)
  })
  it('Waiting state takes precedence', () => {
    expect(mount(StatusBadge, { props: { status: 'healthy', setup: 'awaiting_approval' } }).text()).toBe('Wartet auf Freigabe')
  })
})

describe('SecretField', () => {
  it('masks, shows only on request and clears the value on leaving', async () => {
    const value = ref('secret')
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
  it('shows the value, the "only once" hint and reports closing', async () => {
    const w = mount(OneTimeSecret, { props: { title: 'Token erzeugt', value: 'mcpw_pat_abc' } })
    expect(w.attributes('role')).toBe('status')
    expect(w.text()).toContain('mcpw_pat_abc')
    expect(w.text()).toContain('nur jetzt')
    await w.findAll('button').at(-1)!.trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})

describe('SparkBars', () => {
  it('has a text alternative', () => {
    const w = mount(SparkBars, { props: { items: ['ok', 'ok', 'err'] } })
    expect(w.find('.sr-only').text()).toBe('Letzte 3 Einträge: 2 ohne Fehler, 1 mit Fehlern')
  })
})

describe('ToolTable', () => {
  const tool = (name: string): UpstreamToolItem => ({ name, title: null, description: '<b>x</b>', enabled: false, gone: false, firstSeenAt: '', lastSeenAt: '', annotations: { readOnlyHint: true } })
  it('Switch acts optimistically and is rolled back on error', async () => {
    const save = vi.fn().mockRejectedValue(new Error('x'))
    const w = mount(ToolTable, { props: { tools: [tool('list_issues')], save }, attachTo: document.body })
    const sw = () => w.find('button[role="switch"]')
    expect(sw().attributes('aria-checked')).toBe('false')
    await sw().trigger('click')
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith('list_issues', true))
    await vi.waitFor(() => expect(sw().attributes('aria-checked')).toBe('false'))
  })
  it('renders descriptions as text only', () => {
    const w = mount(ToolTable, { props: { tools: [tool('a')], save: vi.fn() } })
    expect(w.find('b').exists()).toBe(false)
    expect(w.text()).toContain('<b>x</b>')
  })
})

describe('ConfirmDialog', () => {
  it('reports confirm as long as the page still knows its target, and closes afterwards', async () => {
    const target = ref<string | null>('token-1')
    const seen: Array<string | null> = []
    const Host = defineComponent({
      setup: () => () => h(ConfirmDialog, {
        'open': target.value !== null, 'title': 'Token widerrufen?', 'confirmLabel': 'Widerrufen',
        'onUpdate:open': (v: boolean) => { if (!v) target.value = null },
        'onConfirm': () => seen.push(target.value),
      }),
    })
    const w = mount(Host, { attachTo: document.body })
    await vi.waitFor(() => expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy())
    const btn = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Widerrufen')!
    btn.click()
    await vi.waitFor(() => expect(target.value).toBeNull())
    expect(seen).toEqual(['token-1'])
    w.unmount()
  })
})
