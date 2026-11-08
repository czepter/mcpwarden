<script setup lang="ts">
import { linkApi } from '~/api'
import { ApiError } from '~/api/http'
import ErrorState from '~/components/common/ErrorState.vue'
import FormRow from '~/components/common/FormRow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import SecretField from '~/components/common/SecretField.vue'
import { Check, X } from '@lucide/vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { formatCountdown } from '~/lib/format'

definePageMeta({ layout: 'auth-card', middleware: 'phase2' })
const { t } = useI18n()
useHead({ title: () => t('auth.link.docTitle'), meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex' }] })
const token = String(useRoute().params.token)
const { data, error, status } = useAsyncData(`link-${token.length}`, () => linkApi.get(token), { server: false })
const value = ref('')
const header = ref('')
const result = ref<{ ok: boolean, text: string } | null>(null)
const busy = ref(false)
onBeforeUnmount(() => { value.value = '' })
const left = computed(() => (data.value?.state === 'open' ? formatCountdown(data.value.expiresAt) : ''))
async function run(save: boolean) {
  busy.value = true; result.value = null
  try {
    if (save) { await linkApi.submit(token, value.value, header.value || undefined); value.value = ''; await navigateTo('/link/done?status=connected') } else {
      const r = await linkApi.test(token, value.value)
      result.value = { ok: r.ok, text: r.ok ? t('auth.link.toolsFound', { count: r.toolCount ?? 0 }, r.toolCount ?? 0) : (r.message ?? t('auth.link.testFailed')) }
    }
  } catch (e) { result.value = { ok: false, text: e instanceof ApiError ? e.message : t('auth.link.error') } } finally { busy.value = false }
}
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <LoadingRows v-if="status === 'pending'" :rows="3" />
    <ErrorState v-else-if="error" :error="error" />
    <div v-else-if="data?.state === 'open'" class="flex flex-col gap-5">
      <div class="flex items-center gap-3">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground" aria-hidden="true">m</div>
        <div>
          <h1 class="text-lg font-semibold">{{ data.kind === 'header' ? $t('auth.link.titleHeader', { slug: data.upstream.slug }) : $t('auth.link.titleToken', { slug: data.upstream.slug }) }}</h1>
          <p class="text-[13px] text-muted-foreground">{{ $t('auth.link.expiresIn', { left }) }}</p>
        </div>
      </div>
      <dl class="grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-sm border bg-table-head px-3.5 py-3 text-[13px]">
        <dt class="text-muted-foreground">{{ $t('auth.link.upstream') }}</dt><dd class="font-medium">{{ data.upstream.slug }}</dd>
        <dt class="text-muted-foreground">{{ $t('auth.link.url') }}</dt><dd class="mono text-xs">{{ data.upstream.url }}</dd>
        <dt class="text-muted-foreground">{{ $t('auth.link.auth') }}</dt><dd>{{ data.kind === 'header' ? $t('auth.link.authHeader') : $t('auth.link.authBearer') }}</dd>
      </dl>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="run(true)">
        <FormRow v-if="data.kind === 'header'" id="l-h" :label="$t('auth.link.headerName')"><template #default="{ id }"><Input :id="id" v-model="header" class="mono" :placeholder="data.headerName" /></template></FormRow>
        <FormRow id="l-v" :label="data.kind === 'header' ? $t('auth.link.headerValue') : $t('auth.link.bearerToken')" :description="$t('auth.link.secretHint')">
          <template #default="{ id, describedby }"><SecretField :id="id" v-model="value" :describedby="describedby" /></template>
        </FormRow>
        <div v-if="result" :role="result.ok ? 'status' : 'alert'" :class="result.ok ? 'bg-ok-bg text-ok-fg' : 'bg-err-bg text-err-fg'" class="flex items-start gap-2.5 rounded-sm px-3 py-2.5 text-[13px]"><component :is="result.ok ? Check : X" class="mt-px size-[18px] shrink-0" aria-hidden="true" /><div><div class="font-semibold">{{ result.ok ? $t('auth.link.testOk') : $t('auth.link.testFail') }}</div><div>{{ result.text }}</div></div></div>
        <div class="flex justify-end gap-2"><Button type="button" variant="outline" :disabled="busy || !value" @click="run(false)">{{ $t('auth.link.test') }}</Button><Button type="submit" :disabled="busy || !value">{{ $t('auth.link.save') }}</Button></div>
      </form>
      <p class="border-t pt-3.5 text-[13px] text-secondary-foreground">{{ $t('auth.link.afterwards') }}</p>
    </div>
    <div v-else class="flex flex-col gap-3">
      <div class="flex items-center gap-3"><div class="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground" aria-hidden="true">m</div><h1 class="text-lg font-semibold">{{ $t('auth.link.unusableTitle') }}</h1></div>
      <p role="alert" class="text-[13px]">{{ data?.state === 'used' ? $t('auth.link.used') : $t('auth.link.expired') }} {{ $t('auth.link.getNew') }}</p>
    </div>
  </div>
</template>
