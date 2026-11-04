<script setup lang="ts">
import type { Capabilities, TestResult as TestResultT, UpstreamDetail } from '#shared/api-types'
import { computed, reactive, ref, watch } from 'vue'
import { upstreamApi } from '~/api'
import FormRow from '~/components/common/FormRow.vue'
import SecretField from '~/components/common/SecretField.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Input } from '~/components/ui/input'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Spinner } from '~/components/ui/spinner'
import { Textarea } from '~/components/ui/textarea'
import { stdioReasonLabel } from '~/lib/labels'
import { useZodForm } from '~/lib/useZodForm'
import { upstreamSchema } from '~/lib/zod-schemas'
import SlugField from './SlugField.vue'

const props = defineProps<{ caps: Capabilities, initial?: UpstreamDetail }>()
const emit = defineEmits<{ saved: [u: UpstreamDetail, test: TestResultT | null] }>()
const edit = computed(() => !!props.initial)
const d = props.caps.defaults
const i = props.initial
const { form, formError, busy, submit } = useZodForm(upstreamSchema, {
  type: i?.type ?? 'http', name: i?.name ?? '', slug: i?.slug ?? '', url: i?.url ?? '', transport: i?.transport ?? 'auto',
  authType: (i?.authType === 'oauth' ? 'none' : i?.authType) ?? 'none', authHeaderName: i?.authHeaderName ?? '', secret: '',
  command: i?.command ?? '', args: i?.args.join('\n') ?? '', cwd: i?.cwd ?? '',
  ratePerMin: i?.ratePerMin ?? d.ratePerMin, maxConcurrent: i?.maxConcurrent ?? d.maxConcurrent,
  connectS: (i?.timeouts.connectMs ?? d.timeouts.connectMs) / 1000, listS: (i?.timeouts.listMs ?? d.timeouts.listMs) / 1000, callS: (i?.timeouts.callMs ?? d.timeouts.callMs) / 1000,
})
const KEYS = ['type', 'name', 'slug', 'url', 'transport', 'authType', 'authHeaderName', 'secret', 'command', 'args', 'cwd', 'ratePerMin', 'maxConcurrent', 'connectS', 'listS', 'callS'] as const
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fv = reactive(Object.fromEntries(KEYS.map(k => [k, form.defineField(k)[0]]))) as unknown as Record<(typeof KEYS)[number], any>
const err = (k: string) => (form.errors.value as Record<string, string | undefined>)[k]
const advanced = ref(false)
const stdioBlocked = computed(() => !props.caps.stdio.allowed)
watch(() => fv.type as string, (t) => { if (t === 'stdio' && stdioBlocked.value) form.setFieldValue('type', 'http') })

const onSubmit = submit(async (v) => {
  let test: TestResultT | null = null
  const body = {
    name: v.name, ratePerMin: v.ratePerMin, maxConcurrent: v.maxConcurrent,
    timeouts: { connectMs: v.connectS * 1000, listMs: v.listS * 1000, callMs: v.callS * 1000 },
    ...(v.type === 'http' ? { url: v.url.trim(), transport: v.transport, authType: v.authType, authHeaderName: v.authType === 'header' ? v.authHeaderName : undefined } : {}),
    ...(v.type === 'stdio' ? { command: v.command.trim(), args: v.args.split('\n').map(s => s.trim()).filter(Boolean), cwd: v.cwd || undefined } : {}),
  }
  let u: UpstreamDetail
  if (props.initial) u = await upstreamApi.patch(props.initial.id, body)
  else u = await upstreamApi.create({ ...body, slug: v.slug, type: v.type })
  try {
    if (v.secret) { await upstreamApi.putSecret(u.id, { kind: v.authType === 'header' ? 'header' : 'bearer', name: v.authType === 'header' ? v.authHeaderName : undefined, value: v.secret }); u.hasSecret = true }
  } finally { form.setFieldValue('secret', '') }
  if (!props.initial) test = await upstreamApi.test(u.id)
  emit('saved', u, test)
}, ['name', 'slug', 'url', 'command', 'authHeaderName'])
</script>

<template>
  <form class="flex max-w-[600px] flex-col gap-5 rounded-lg border bg-card p-5" novalidate @submit.prevent="onSubmit">
    <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>

    <fieldset v-if="!edit" class="flex flex-col gap-2">
      <legend class="mb-1 text-sm font-medium">Typ</legend>
      <RadioGroup v-model="fv.type" class="grid grid-cols-2 gap-2" aria-label="Typ">
        <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 py-2" :class="fv.type === 'http' ? 'border-primary bg-primary-tint' : ''"><RadioGroupItem value="http" />HTTP</label>
        <label class="flex min-h-11 items-center gap-2 rounded-sm border px-3 py-2" :class="[fv.type === 'stdio' ? 'border-primary bg-primary-tint' : '', stdioBlocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer']">
          <RadioGroupItem value="stdio" :disabled="stdioBlocked" />stdio <span class="text-xs text-muted-foreground">braucht Freigabe</span>
        </label>
      </RadioGroup>
      <p v-if="stdioBlocked" class="text-[13px] text-muted-foreground" data-testid="stdio-reason">stdio ist gesperrt: {{ stdioReasonLabel(caps.stdio.reason ?? '') }}</p>
    </fieldset>

    <FormRow id="u-name" label="Anzeigename" :error="err('name')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.name" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
    <FormRow id="u-slug" label="Kurzname" description="Teil der Tool-Namen, danach nicht mehr änderbar." :error="err('slug')">
      <template #default="{ id, invalid, describedby }"><SlugField :id="id" v-model="fv.slug" :invalid="invalid" :describedby="describedby" :disabled="edit" /></template>
    </FormRow>

    <div v-if="fv.type === 'http'" class="flex flex-col gap-5">
      <FormRow id="u-url" label="Server-URL" :error="err('url')"><template #default="s"><Input :id="s.id" v-model="fv.url" class="mono" placeholder="mcp.example.com/mcp" :aria-invalid="s.invalid || undefined" :aria-describedby="s.describedby" /></template></FormRow>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-sm font-medium">Anmeldung</legend>
        <RadioGroup v-model="fv.authType" class="grid grid-cols-3 gap-2" aria-label="Anmeldung">
          <label v-for="[v, l] in [['none', 'Keine'], ['bearer', 'Bearer'], ['header', 'Header']]" :key="v" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-3 py-2" :class="fv.authType === v ? 'border-primary bg-primary-tint' : ''"><RadioGroupItem :value="v" />{{ l }}</label>
        </RadioGroup>
      </fieldset>
      <FormRow v-if="fv.authType === 'header'" id="u-hname" label="Header-Name" :error="err('authHeaderName')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.authHeaderName" class="mono" placeholder="X-Api-Key" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
      <FormRow v-if="fv.authType !== 'none'" id="u-secret" :label="edit ? 'Secret ersetzen' : 'Secret'" :description="initial?.hasSecret ? 'Ein Secret ist gesetzt. Es wird nie angezeigt, nur ersetzt.' : 'Wird verschlüsselt gespeichert und nie wieder angezeigt.'" :optional="edit">
        <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="fv.secret" :invalid="invalid" :describedby="describedby" /></template>
      </FormRow>
    </div>

    <div v-if="fv.type === 'stdio'" class="flex flex-col gap-5">
      <FormRow id="u-cmd" label="Befehl" :error="err('command')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.command" class="mono" placeholder="uvx mcp-server-duckdb" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
      <FormRow id="u-args" label="Argumente" description="Ein Argument pro Zeile." optional><template #default="{ id }"><Textarea :id="id" v-model="fv.args" rows="3" class="mono" /></template></FormRow>
      <FormRow id="u-cwd" label="Arbeitsordner" description="Relativ zum Nutzerverzeichnis, ohne „..“." :error="err('cwd')" optional><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.cwd" class="mono" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
    </div>

    <Collapsible v-model:open="advanced">
      <CollapsibleTrigger as-child><Button type="button" variant="ghost" class="px-0">Erweitert {{ advanced ? '▴' : '▾' }}</Button></CollapsibleTrigger>
      <CollapsibleContent class="mt-2 grid grid-cols-2 gap-3">
        <FormRow id="u-rate" label="Aufrufe pro Minute" :error="err('ratePerMin')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.ratePerMin" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-par" label="Parallel" :error="err('maxConcurrent')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.maxConcurrent" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-tc" label="Timeout Verbinden (s)" :error="err('connectS')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.connectS" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-tl" label="Timeout Liste (s)" :error="err('listS')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.listS" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-tk" label="Timeout Aufruf (s)" :error="err('callS')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.callS" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
      </CollapsibleContent>
    </Collapsible>

    <div class="flex flex-wrap justify-end gap-2">
      <Button as-child variant="outline"><NuxtLink :to="edit ? `/upstreams/${initial!.id}` : '/upstreams'">Abbrechen</NuxtLink></Button>
      <Button type="submit" :disabled="busy" :aria-busy="busy"><Spinner v-if="busy" />{{ edit ? 'Speichern' : 'Anlegen und verbinden' }}</Button>
    </div>
  </form>
</template>
