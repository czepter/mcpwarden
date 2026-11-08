<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import { computed, reactive, watch } from 'vue'
import type { RestMethod, RestToolInput } from '#shared/api-types'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'

/**
 * Editor of the REST tools of a REST upstream. The parameters are simple rows (name, type, required, description) that are
 * turned into the tool's JSON Schema; schema details the rows cannot show (enum, items, maxLength ...) travel in `extra` and
 * are written back unchanged, so editing a tool that came from the API or an import never silently drops them.
 */
const props = defineProps<{ modelValue: RestToolInput[], slug?: string, errors?: string }>()
const emit = defineEmits<{ 'update:modelValue': [v: RestToolInput[]] }>()

type Param = { name: string, type: string, required: boolean, description: string, extra: Record<string, unknown> }
type Row = { key: number, name: string, description: string, method: RestMethod, urlTemplate: string, params: Param[], headers: string, bodyTemplate: string, enabled: boolean, open: boolean }
const METHODS: RestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object']
let seq = 0

const fromTool = (t: RestToolInput): Row => {
  const schema = (t.inputSchema ?? {}) as { properties?: Record<string, Record<string, unknown>>, required?: string[] }
  const required = new Set(schema.required ?? [])
  return {
    key: ++seq, name: t.name, description: t.description ?? '', method: t.method ?? 'GET', urlTemplate: t.urlTemplate, enabled: t.enabled !== false, open: false,
    params: Object.entries(schema.properties ?? {}).map(([name, p]) => {
      const { type, description, ...extra } = p
      return { name, type: typeof type === 'string' ? type : 'string', required: required.has(name), description: typeof description === 'string' ? description : '', extra }
    }),
    headers: Object.entries(t.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'), bodyTemplate: t.bodyTemplate ?? '',
  }
}
const rows = reactive<Row[]>(props.modelValue.map(fromTool))

const parseHeaders = (s: string): { ok: boolean, value: Record<string, string> } => {
  const value: Record<string, string> = {}
  let ok = true
  for (const line of s.split('\n')) {
    if (!line.trim()) continue
    const i = line.indexOf(':')
    if (i < 1) { ok = false; continue }
    value[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { ok, value }
}
const toTool = (r: Row): RestToolInput => {
  const properties = Object.fromEntries(r.params.filter(p => p.name.trim()).map(p => [p.name.trim(), { ...p.extra, type: p.type, ...(p.description.trim() ? { description: p.description.trim() } : {}) }]))
  const required = r.params.filter(p => p.required && p.name.trim()).map(p => p.name.trim())
  return {
    name: r.name.trim(), method: r.method, urlTemplate: r.urlTemplate.trim(), enabled: r.enabled,
    description: r.description.trim() || null,
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    headers: parseHeaders(r.headers).value, bodyTemplate: r.method === 'GET' || r.method === 'DELETE' ? null : (r.bodyTemplate.trim() || null),
  }
}
watch(rows, () => emit('update:modelValue', rows.map(toTool)), { deep: true })

const PH = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g
const placeholdersOf = (r: Row) => [...new Set([r.urlTemplate, ...r.headers.split('\n').map(l => l.slice(l.indexOf(':') + 1)), r.bodyTemplate].flatMap(s => [...s.matchAll(PH)].map(m => m[1]!)))]
const missing = (r: Row) => placeholdersOf(r).filter(n => !r.params.some(p => p.name.trim() === n))
const addMissing = (r: Row) => {
  const inPath = (n: string) => r.urlTemplate.split(/[?#]/)[0]!.includes(`{${n}}`)
  for (const n of missing(r)) r.params.push({ name: n, type: 'string', required: inPath(n), description: '', extra: {} })
}
const addTool = () => { rows.push({ key: ++seq, name: '', description: '', method: 'GET', urlTemplate: '', params: [], headers: '', bodyTemplate: '', enabled: true, open: false }) }
const headersInvalid = (r: Row) => !parseHeaders(r.headers).ok
const example = computed(() => `${props.slug || 'api'}__…`)
</script>

<template>
  <fieldset class="flex flex-col gap-3" data-testid="rest-tools">
    <legend class="mb-1 text-sm font-medium">{{ $t('upstreams.rest.tools') }}</legend>
    <p class="text-[13px] text-muted-foreground">{{ $t('upstreams.rest.toolsDesc', { sample: '{id}' }) }}</p>
    <p v-if="!rows.length" class="rounded-sm bg-muted px-3 py-2.5 text-[13px] text-secondary-foreground" data-testid="rest-empty">{{ $t('upstreams.rest.empty') }}</p>

    <section v-for="(r, n) in rows" :key="r.key" class="flex flex-col gap-3 rounded-md border p-3" :aria-label="$t('upstreams.rest.toolTitle', { n: n + 1 })" data-testid="rest-tool">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{{ r.name || $t('upstreams.rest.toolTitle', { n: n + 1 }) }}</h3>
        <Button type="button" variant="ghost" size="icon" :aria-label="$t('upstreams.rest.removeTool', { n: n + 1 })" @click="rows.splice(n, 1)"><X class="size-4" aria-hidden="true" /></Button>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
        <div class="flex flex-col gap-1.5">
          <label :for="`rt-name-${r.key}`" class="text-[13px] font-medium">{{ $t('upstreams.rest.name') }}</label>
          <Input :id="`rt-name-${r.key}`" v-model="r.name" class="mono" placeholder="get_item" />
          <span class="text-xs text-muted-foreground">{{ $t('upstreams.rest.nameDesc', { example }) }}</span>
        </div>
        <div class="flex flex-col gap-1.5">
          <label :for="`rt-method-${r.key}`" class="text-[13px] font-medium">{{ $t('upstreams.rest.method') }}</label>
          <select :id="`rt-method-${r.key}`" v-model="r.method" class="mono h-11 rounded-md border bg-background px-3 text-sm">
            <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <label :for="`rt-url-${r.key}`" class="text-[13px] font-medium">{{ $t('upstreams.rest.urlTemplate') }}</label>
        <Input :id="`rt-url-${r.key}`" v-model="r.urlTemplate" class="mono" placeholder="/items/{id}" />
        <span class="text-xs text-muted-foreground">{{ $t('upstreams.rest.urlTemplateDesc', { sample: '{id}, ?q={q}' }) }}</span>
      </div>
      <div class="flex flex-col gap-1.5">
        <label :for="`rt-desc-${r.key}`" class="text-[13px] font-medium">{{ $t('upstreams.rest.description') }}</label>
        <Input :id="`rt-desc-${r.key}`" v-model="r.description" />
        <span class="text-xs text-muted-foreground">{{ $t('upstreams.rest.descriptionDesc') }}</span>
      </div>

      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-[13px] font-medium">{{ $t('upstreams.rest.params') }}</legend>
        <div v-for="(p, m) in r.params" :key="m" class="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto_minmax(0,1.5fr)_auto]">
          <Input v-model="p.name" class="mono" :aria-label="`${$t('upstreams.rest.paramName')} ${m + 1}`" placeholder="id" />
          <select v-model="p.type" class="h-11 rounded-md border bg-background px-2 text-sm" :aria-label="`${$t('upstreams.rest.paramType')} ${m + 1}`">
            <option v-for="ty in TYPES" :key="ty" :value="ty">{{ ty }}</option>
          </select>
          <label class="flex min-h-11 items-center gap-2 text-[13px]"><Checkbox :model-value="p.required" :aria-label="`${$t('upstreams.rest.paramRequired')} ${m + 1}`" @update:model-value="(v: boolean | 'indeterminate') => (p.required = v === true)" />{{ $t('upstreams.rest.paramRequired') }}</label>
          <Input v-model="p.description" class="col-span-2 sm:col-span-1" :aria-label="`${$t('upstreams.rest.paramDescription')} ${m + 1}`" :placeholder="$t('upstreams.rest.paramDescription')" />
          <Button type="button" variant="ghost" size="icon" :aria-label="$t('upstreams.rest.removeParam', { n: m + 1 })" @click="r.params.splice(m, 1)"><X class="size-4" aria-hidden="true" /></Button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" class="w-fit" @click="r.params.push({ name: '', type: 'string', required: false, description: '', extra: {} })"><Plus class="size-4" aria-hidden="true" />{{ $t('upstreams.rest.addParam') }}</Button>
          <template v-if="missing(r).length">
            <span class="text-[13px] text-warn-fg" role="status" data-testid="rest-missing">{{ $t('upstreams.rest.missingParams', { names: missing(r).join(', ') }) }}</span>
            <Button type="button" variant="outline" @click="addMissing(r)">{{ $t('upstreams.rest.addMissing') }}</Button>
          </template>
        </div>
      </fieldset>

      <button type="button" class="min-h-11 w-fit text-[13px] font-medium text-primary hover:underline" :aria-expanded="r.open" @click="r.open = !r.open">{{ $t('upstreams.rest.more') }} {{ r.open ? '▴' : '▾' }}</button>
      <div v-if="r.open" class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <label :for="`rt-h-${r.key}`" class="text-[13px] font-medium">{{ $t('upstreams.rest.headers') }}</label>
          <Textarea :id="`rt-h-${r.key}`" v-model="r.headers" class="mono min-h-20" placeholder="X-Tenant: {tenant}" :aria-invalid="headersInvalid(r) || undefined" />
          <span class="text-xs text-muted-foreground">{{ $t('upstreams.rest.headersDesc') }}</span>
          <span v-if="headersInvalid(r)" class="text-xs text-destructive" role="alert">{{ $t('upstreams.rest.invalidHeaders') }}</span>
        </div>
        <div v-if="r.method !== 'GET' && r.method !== 'DELETE'" class="flex flex-col gap-1.5">
          <label :for="`rt-b-${r.key}`" class="text-[13px] font-medium">{{ $t('upstreams.rest.bodyTemplate') }}</label>
          <Textarea :id="`rt-b-${r.key}`" v-model="r.bodyTemplate" class="mono min-h-24" placeholder="{&quot;title&quot;: &quot;{title}&quot;}" />
          <span class="text-xs text-muted-foreground">{{ $t('upstreams.rest.bodyTemplateDesc') }}</span>
        </div>
        <label class="flex min-h-11 items-center gap-2 text-[13px]"><Checkbox :model-value="r.enabled" :aria-label="$t('upstreams.rest.enabled')" @update:model-value="(v: boolean | 'indeterminate') => (r.enabled = v === true)" />{{ $t('upstreams.rest.enabled') }}</label>
      </div>
    </section>

    <p v-if="errors" class="text-[13px] text-destructive" role="alert" data-testid="rest-error">{{ errors }}</p>
    <Button type="button" variant="secondary" class="w-fit" data-testid="rest-add-tool" @click="addTool"><Plus class="size-4" aria-hidden="true" />{{ $t('upstreams.rest.addTool') }}</Button>
  </fieldset>
</template>
