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
      <h1 class="text-lg font-semibold">Zugangsdaten für {{ data.upstream.slug }}</h1>
      <p class="mono mb-4 text-xs text-muted-foreground">{{ data.upstream.url }}</p>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="run(true)">
        <FormRow v-if="data.kind === 'header'" id="l-h" label="Header-Name"><template #default="{ id }"><Input :id="id" v-model="header" class="mono" :placeholder="data.headerName" /></template></FormRow>
        <FormRow id="l-v" :label="data.kind === 'header' ? 'Header-Wert' : 'Bearer-Token'" description="Wird nie wieder angezeigt, nur ersetzt.">
          <template #default="{ id, describedby }"><SecretField :id="id" v-model="value" :describedby="describedby" /></template>
        </FormRow>
        <p v-if="result" :role="result.ok ? 'status' : 'alert'" :class="result.ok ? 'text-[#14532d]' : 'text-destructive'" class="text-sm">{{ result.text }}</p>
        <div class="flex justify-end gap-2"><Button type="button" variant="outline" :disabled="busy || !value" @click="run(false)">Testen</Button><Button type="submit" :disabled="busy || !value">Speichern</Button></div>
      </form>
      <p class="mt-4 text-xs text-muted-foreground">Der Link läuft in {{ left }} min ab und gilt nur einmal.</p>
    </template>
    <template v-else>
      <h1 class="mb-2 text-lg font-semibold">Link nicht nutzbar</h1>
      <p role="alert" class="text-[13px]">{{ data?.state === 'used' ? 'Dieser Link wurde bereits verwendet.' : 'Dieser Link ist abgelaufen.' }} Lass dir im Coding-Tool einen neuen Link geben.</p>
    </template>
  </div>
</template>
