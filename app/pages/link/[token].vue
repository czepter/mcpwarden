<script setup lang="ts">
import { linkApi } from '~/api'
import { ApiError } from '~/api/http'
import ErrorState from '~/components/common/ErrorState.vue'
import FormRow from '~/components/common/FormRow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import SecretField from '~/components/common/SecretField.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { formatCountdown } from '~/lib/format'

definePageMeta({ layout: 'auth', middleware: 'phase2' })
useHead({ title: 'Anmeldedaten eintragen · mcpwarden', meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex' }] })
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
      result.value = { ok: r.ok, text: r.ok ? `${r.toolCount} Tools gefunden.` : (r.message ?? 'Test fehlgeschlagen.') }
    }
  } catch (e) { result.value = { ok: false, text: e instanceof ApiError ? e.message : 'Fehler.' } } finally { busy.value = false }
}
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <LoadingRows v-if="status === 'pending'" :rows="3" />
    <ErrorState v-else-if="error" :error="error" />
    <template v-else-if="data?.state === 'open'">
      <h1 class="text-lg font-semibold">{{ data.kind === 'header' ? 'Header-Wert' : 'Token' }} für {{ data.upstream.slug }} eingeben</h1>
      <p class="mb-4 text-[13px] text-muted-foreground">Dieser Link läuft in {{ left }} min ab und gilt nur einmal.</p>
      <dl class="mb-5 grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-sm border bg-table-head px-3.5 py-3 text-[13px]">
        <dt class="text-muted-foreground">Upstream</dt><dd class="font-medium">{{ data.upstream.slug }}</dd>
        <dt class="text-muted-foreground">URL</dt><dd class="mono text-xs">{{ data.upstream.url }}</dd>
        <dt class="text-muted-foreground">Auth</dt><dd>{{ data.kind === 'header' ? 'Header' : 'Bearer-Token' }}</dd>
      </dl>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="run(true)">
        <FormRow v-if="data.kind === 'header'" id="l-h" label="Header-Name"><template #default="{ id }"><Input :id="id" v-model="header" class="mono" :placeholder="data.headerName" /></template></FormRow>
        <FormRow id="l-v" :label="data.kind === 'header' ? 'Header-Wert' : 'Bearer-Token'" description="Wird verschlüsselt gespeichert und danach nie wieder angezeigt. Du kannst es nur ersetzen.">
          <template #default="{ id, describedby }"><SecretField :id="id" v-model="value" :describedby="describedby" /></template>
        </FormRow>
        <p v-if="result" :role="result.ok ? 'status' : 'alert'" :class="result.ok ? 'bg-ok-bg text-ok-fg' : 'bg-err-bg text-err-fg'" class="rounded-sm px-3 py-2.5 text-[13px]"><span class="font-semibold">{{ result.ok ? 'Verbindungstest erfolgreich' : 'Verbindungstest fehlgeschlagen' }}</span><br>{{ result.text }}</p>
        <div class="flex justify-end gap-2"><Button type="button" variant="outline" :disabled="busy || !value" @click="run(false)">Testen</Button><Button type="submit" :disabled="busy || !value">Speichern</Button></div>
      </form>
      <p class="mt-5 border-t pt-3.5 text-[13px] text-secondary-foreground">Danach kannst du zurück in dein Coding-Tool wechseln und den Status dort erneut abfragen.</p>
    </template>
    <template v-else>
      <h1 class="mb-2 text-lg font-semibold">Link nicht nutzbar</h1>
      <p role="alert" class="text-[13px]">{{ data?.state === 'used' ? 'Dieser Link wurde bereits verwendet.' : 'Dieser Link ist abgelaufen.' }} Lass dir im Coding-Tool einen neuen Link geben.</p>
    </template>
  </div>
</template>
