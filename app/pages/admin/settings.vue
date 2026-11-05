<script setup lang="ts">
import { toast } from 'vue-sonner'
import { adminApi } from '~/api'
import { ApiError } from '~/api/http'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import AdminTabs from '~/components/shell/AdminTabs.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'

definePageMeta({ middleware: 'admin' })
useHead({ title: 'Admin: Instanz · mcpwarden' })
const { data, error, status, refresh } = useApi('admin-settings', adminApi.settings)
const warnings = ref<string[]>([])
const entry = ref('')
const entryError = ref('')
async function put(b: Parameters<typeof adminApi.putSettings>[0]) {
  try {
    const r = await adminApi.putSettings(b)
    warnings.value = r.warnings.map(w => w.entry)
    await refresh(); toast.success('Gespeichert.')
    return true
  } catch (e) { entryError.value = e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.'; return false }
}
async function addEntry() {
  entryError.value = ''
  const v = entry.value.trim().toLowerCase()
  if (!v) { entryError.value = 'Bitte gib einen CIDR-Bereich oder Hostnamen ein.'; return }
  if (await put({ 'ssrf.allow': [...(data.value?.['ssrf.allow'] ?? []), v] })) entry.value = ''
}
const removeEntry = (e: string) => put({ 'ssrf.allow': (data.value?.['ssrf.allow'] ?? []).filter(x => x !== e) })
</script>

<template>
  <PageHeader title="Admin" />
  <AdminTabs />
  <LoadingRows v-if="status === 'pending' && !data" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
  <div v-else-if="data" class="flex max-w-[720px] flex-col gap-4">
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-stdio">
      <div class="flex items-start justify-between gap-4">
        <div><h2 id="h-stdio" class="text-base font-semibold"><label for="sw-stdio">stdio-Upstreams erlauben</label></h2>
          <p class="text-[13px] text-muted-foreground">stdio führt Code auf dem Host aus. Zusätzlich muss jeder Nutzer einzeln freigegeben werden.</p></div>
        <Switch id="sw-stdio" :model-value="data['stdio.enabled']" @update:model-value="(v) => put({ 'stdio.enabled': v })" />
      </div>
    </section>
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-ssrf">
      <h2 id="h-ssrf" class="text-base font-semibold">SSRF-Ausnahmen</h2>
      <p class="mb-3 text-[13px] text-muted-foreground">Ziele (CIDR oder Hostname), die trotz SSRF-Schutz erreichbar sind.</p>
      <Alert v-for="w in warnings" :key="w" role="alert" class="mb-2 border-warn-border bg-warn-bg text-[13px] text-warn-fg">{{ w }} deckt Metadaten-Adressen ab (169.254.169.254). Das kann Cloud-Zugangsdaten offenlegen.</Alert>
      <ul v-if="data['ssrf.allow'].length" class="mb-3 divide-y rounded-sm border">
        <li v-for="e in data['ssrf.allow']" :key="e" class="flex min-h-11 items-center justify-between px-3"><code class="text-xs">{{ e }}</code><Button variant="ghost" :aria-label="`Ausnahme ${e} entfernen`" @click="removeEntry(e)">Entfernen</Button></li>
      </ul>
      <p v-else class="mb-3 text-[13px]">Keine Ausnahmen.</p>
      <form class="flex gap-2" novalidate @submit.prevent="addEntry">
        <div class="flex-1"><label for="ssrf-new" class="sr-only">Neue Ausnahme</label><Input id="ssrf-new" v-model="entry" class="mono" placeholder="10.0.0.0/8 oder intern.example" :aria-invalid="!!entryError || undefined" aria-describedby="ssrf-err" /><p id="ssrf-err" role="alert" class="mt-1 text-sm text-destructive">{{ entryError }}</p></div>
        <Button type="submit">+ Eintrag</Button>
      </form>
    </section>
    <p class="text-[13px] text-muted-foreground">Registrierung ist nur per Einladungslink möglich (Admin › Nutzer).</p>
  </div>
</template>
