<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import type { Capabilities, UpstreamTestResult as TestResultT, UpstreamDetail } from '#shared/api-types'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { upstreamApi } from '~/api'
import FormRow from '~/components/common/FormRow.vue'
import SecretField from '~/components/common/SecretField.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible'
import { Input } from '~/components/ui/input'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
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
  authType: (i?.authType === 'env' ? 'none' : i?.authType) ?? 'none', authHeaderName: i?.authHeaderName ?? '', secret: '',
  command: i?.command ?? '', args: i?.args.join('\n') ?? '', cwd: i?.cwd ?? '',
  ratePerMin: i?.ratePerMin ?? d.ratePerMin, maxConcurrent: i?.maxConcurrent ?? d.maxConcurrent,
  connectS: (i?.timeouts.connectMs ?? d.timeouts.connectMs) / 1000, listS: (i?.timeouts.listMs ?? d.timeouts.listMs) / 1000, callS: (i?.timeouts.callMs ?? d.timeouts.callMs) / 1000,
})
const KEYS = ['type', 'name', 'slug', 'url', 'transport', 'authType', 'authHeaderName', 'secret', 'command', 'args', 'cwd', 'ratePerMin', 'maxConcurrent', 'connectS', 'listS', 'callS'] as const
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fv = reactive(Object.fromEntries(KEYS.map(k => [k, form.defineField(k)[0]]))) as unknown as Record<(typeof KEYS)[number], any>
const err = (k: string) => (form.errors.value as Record<string, string | undefined>)[k]
const advanced = ref(false)
// Auto-detection: once the URL looks complete, ask the server whether it offers OAuth (before the user picks a sign-in)
type Probe = 'idle' | 'checking' | 'dcr' | 'no_dcr' | 'none' | 'error'
const probe = ref<Probe>('idle')
let probeTimer: ReturnType<typeof setTimeout> | undefined
let probeSeq = 0
const URL_RE = /^https?:\/\/[^/@\s]+(\/\S*)?$/
watch(() => fv.url as string, (url) => {
  clearTimeout(probeTimer)
  const u = (url ?? '').trim()
  if (fv.type !== 'http' || !URL_RE.test(u) || u === props.initial?.url) { probe.value = 'idle'; return }
  probe.value = 'checking'
  const seq = ++probeSeq
  probeTimer = setTimeout(async () => {
    let r: Probe
    try { r = (await upstreamApi.probe(u)).oauth } catch { r = 'error' }
    if (seq !== probeSeq) return // a newer URL was entered meanwhile
    probe.value = r
    if (r === 'dcr' && fv.authType === 'none') form.setFieldValue('authType', 'oauth')
    if ((r === 'none' || r === 'no_dcr') && fv.authType === 'oauth') form.setFieldValue('authType', 'none')
  }, 600)
})
onBeforeUnmount(() => clearTimeout(probeTimer))
const oauthUnavailable = computed(() => probe.value === 'none' || probe.value === 'no_dcr')
const stdioBlocked = computed(() => !props.caps.stdio.allowed)
// Slim image has no stdio runtime at all: no type choice, no hint.
const stdioAvailable = computed(() => props.caps.stdio.reason !== 'image_slim')
const slugify = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 32).replace(/-+$/, '')
// Short name follows the display name until the user edits it by hand.
let slugTouched = !!i?.slug
watch(() => fv.name as string, (n) => { if (!edit.value && !slugTouched) form.setFieldValue('slug', slugify(n ?? '')) })
watch(() => fv.slug as string, (sl) => { if (sl !== slugify(fv.name ?? '')) slugTouched = true })
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
    if (v.secret && v.authType !== 'oauth') { await upstreamApi.putSecret(u.id, { kind: v.authType === 'header' ? 'header' : 'bearer', name: v.authType === 'header' ? v.authHeaderName : undefined, value: v.secret }); u.hasSecret = true }
  } finally { form.setFieldValue('secret', '') }
  if (!props.initial && v.authType !== 'oauth') test = await upstreamApi.test(u.id) // OAuth: nothing to test before the account is connected
  emit('saved', u, test)
}, ['name', 'slug', 'url', 'command', 'authHeaderName'])
</script>

<template>
  <form class="flex max-w-[600px] flex-col gap-5 rounded-lg border bg-card p-5" novalidate @submit.prevent="onSubmit">
    <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>

    <fieldset v-if="!edit && stdioAvailable" class="flex flex-col gap-2">
      <legend class="mb-1 text-sm font-medium">{{ $t('upstreams.form.type') }}</legend>
      <RadioGroup v-model="fv.type" class="grid grid-cols-2 gap-2" :aria-label="$t('upstreams.form.type')">
        <label class="flex min-h-14 cursor-pointer items-start gap-2 rounded-sm border px-3 py-2" :class="fv.type === 'http' ? 'border-primary bg-primary-tint' : ''"><RadioGroupItem value="http" class="mt-0.5" /><span class="flex flex-col"><span class="font-semibold">HTTP</span><span class="text-xs text-secondary-foreground">Streamable HTTP, SSE</span></span></label>
        <label class="flex min-h-14 items-start gap-2 rounded-sm border px-3 py-2" :class="[fv.type === 'stdio' ? 'border-primary bg-primary-tint' : '', stdioBlocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer']">
          <RadioGroupItem value="stdio" :disabled="stdioBlocked" class="mt-0.5" /><span class="flex flex-col"><span class="font-semibold">stdio</span><span class="text-xs text-secondary-foreground">{{ $t('upstreams.form.stdioHint') }}</span></span>
        </label>
      </RadioGroup>
      <p v-if="stdioBlocked" class="text-[13px] text-muted-foreground" data-testid="stdio-reason">{{ $t('upstreams.form.stdioBlocked', { reason: stdioReasonLabel(caps.stdio.reason ?? '') }) }}</p>
    </fieldset>

    <FormRow id="u-name" :label="$t('upstreams.form.name')" :error="err('name')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.name" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
    <FormRow id="u-slug" :label="$t('upstreams.form.slug')" :description="$t('upstreams.form.slugDesc')" :error="err('slug')">
      <template #default="{ id, invalid, describedby }"><SlugField :id="id" v-model="fv.slug" :invalid="invalid" :describedby="describedby" :disabled="edit" /></template>
    </FormRow>

    <div v-if="fv.type === 'http'" class="flex flex-col gap-5">
      <FormRow id="u-url" :label="$t('upstreams.form.url')" :error="err('url')"><template #default="s"><Input :id="s.id" v-model="fv.url" class="mono" placeholder="mcp.example.com/mcp" :aria-invalid="s.invalid || undefined" :aria-describedby="s.describedby" /></template></FormRow>
      <fieldset class="flex flex-col gap-2">
        <legend class="mb-1 text-sm font-medium">{{ $t('upstreams.form.auth') }}</legend>
        <RadioGroup v-model="fv.authType" class="grid grid-cols-2 gap-2 sm:grid-cols-4" :aria-label="$t('upstreams.form.auth')">
          <label v-for="[v, l] in [['none', $t('upstreams.form.authNone')], ['bearer', 'Bearer'], ['header', 'Header'], ['oauth', 'OAuth']]" :key="v" class="flex min-h-11 items-center gap-2 rounded-sm border px-3 py-2" :class="[fv.authType === v ? 'border-primary bg-primary-tint' : '', v === 'oauth' && oauthUnavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer']"><RadioGroupItem :value="v" :disabled="v === 'oauth' && oauthUnavailable" />{{ l }}</label>
        </RadioGroup>
        <p v-if="probe !== 'idle'" class="text-[13px] text-muted-foreground" role="status" data-testid="oauth-probe">{{ $t(`upstreams.form.probe.${probe}`) }}</p>
      </fieldset>
      <FormRow v-if="fv.authType === 'header'" id="u-hname" :label="$t('upstreams.form.headerName')" :error="err('authHeaderName')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.authHeaderName" class="mono" placeholder="X-Api-Key" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
      <p v-if="fv.authType === 'oauth'" class="text-[13px] text-muted-foreground" data-testid="oauth-hint">{{ edit && initial?.authType === 'oauth' ? $t('upstreams.form.oauthHintEdit') : $t('upstreams.form.oauthHint') }}</p>
      <FormRow v-if="fv.authType === 'bearer' || fv.authType === 'header'" id="u-secret" :label="edit ? $t('upstreams.form.secretReplace') : $t('upstreams.form.secret')" :description="initial?.hasSecret ? $t('upstreams.form.secretSet') : $t('upstreams.form.secretUnset')" :optional="edit">
        <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="fv.secret" :invalid="invalid" :describedby="describedby" /></template>
      </FormRow>
    </div>

    <div v-if="fv.type === 'stdio'" class="flex flex-col gap-5">
      <FormRow id="u-cmd" :label="$t('upstreams.form.command')" :error="err('command')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.command" class="mono" placeholder="uvx mcp-server-duckdb" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
      <FormRow id="u-args" :label="$t('upstreams.form.args')" :description="$t('upstreams.form.argsDesc')" optional><template #default="{ id }"><Textarea :id="id" v-model="fv.args" rows="3" class="mono" /></template></FormRow>
      <FormRow id="u-cwd" :label="$t('upstreams.form.cwd')" :description="$t('upstreams.form.cwdDesc')" :error="err('cwd')" optional><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.cwd" class="mono" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
    </div>

    <Collapsible v-model:open="advanced">
      <CollapsibleTrigger as-child><Button type="button" variant="ghost" class="px-0">{{ $t('upstreams.form.advanced') }} {{ advanced ? '▴' : '▾' }}</Button></CollapsibleTrigger>
      <CollapsibleContent class="mt-2 grid grid-cols-2 gap-3">
        <FormRow id="u-rate" :label="$t('upstreams.form.rate')" :error="err('ratePerMin')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.ratePerMin" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-par" :label="$t('upstreams.form.parallel')" :error="err('maxConcurrent')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.maxConcurrent" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-tc" :label="$t('upstreams.form.tConnect')" :error="err('connectS')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.connectS" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-tl" :label="$t('upstreams.form.tList')" :error="err('listS')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.listS" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="u-tk" :label="$t('upstreams.form.tCall')" :error="err('callS')"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="fv.callS" type="number" min="1" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
      </CollapsibleContent>
    </Collapsible>

    <div class="flex flex-wrap justify-end gap-2">
      <Button as-child variant="outline"><NuxtLink :to="edit ? `/upstreams/${initial!.id}` : '/upstreams'">{{ $t('upstreams.form.cancel') }}</NuxtLink></Button>
      <LoadingButton :busy="busy">{{ edit ? $t('upstreams.form.save') : $t('upstreams.form.create') }}</LoadingButton>
    </div>
  </form>
</template>
