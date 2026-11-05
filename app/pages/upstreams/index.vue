<script setup lang="ts">
import type { TestResult as TestResultT, UpstreamSummary } from '#shared/api-types'
import { toast } from 'vue-sonner'
import { upstreamApi } from '~/api'
import AutoRefresh from '~/components/common/AutoRefresh.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import SparkBars from '~/components/common/SparkBars.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { RefreshCw, Pencil } from '@lucide/vue'
import { formatCountdown, formatMs } from '~/lib/format'
import { HEALTH_VALUES, healthLabel, typeLabel } from '~/lib/labels'

useHead({ title: 'Upstreams · mcpwarden' })
const { data, error, status, refresh } = useApi('upstreams', upstreamApi.list)
const refreshRate = ref(0)
usePolling(refresh, refreshRate)
const q = ref('')
const statusFilter = ref('all')
const typeFilter = ref('all')
const items = computed(() => data.value?.items ?? [])
const filtered = computed(() => items.value.filter(u =>
  (statusFilter.value === 'all' || u.status === statusFilter.value)
  && (typeFilter.value === 'all' || u.type === typeFilter.value)
  && (!q.value || `${u.name} ${u.slug} ${u.url ?? ''} ${u.command ?? ''}`.toLowerCase().includes(q.value.toLowerCase()))))
const counts = computed(() => HEALTH_VALUES.filter(h => h !== 'unknown').map(h => ({ h, n: items.value.filter(u => u.status === h).length })))
const hasP95 = computed(() => items.value.some(u => u.p95Ms != null))
const hasRecent = computed(() => items.value.some(u => u.recent))
const testing = ref<string | null>(null)
async function runTest(u: UpstreamSummary) {
  testing.value = u.id
  try {
    const r: TestResultT = await upstreamApi.test(u.id)
    if (r.ok) toast.success(`${u.name}: ${r.tools.length} Tools gefunden.`); else toast.error(`${u.name}: ${r.message}`)
    await refresh()
  } catch { toast.error('Test fehlgeschlagen.') } finally { testing.value = null }
}
const message = (u: UpstreamSummary) => {
  if (u.status === 'open' && u.nextRetryAt) return `Breaker offen, nächster Versuch in ${formatCountdown(u.nextRetryAt)}.`
  if (u.setup !== 'ready') return u.setup === 'awaiting_auth' ? 'Warte auf Anmeldedaten.' : 'Wartet auf Freigabe.'
  return u.statusReason ?? ''
}
const sub = (u: UpstreamSummary) => (u.url ?? u.command ?? '').replace(/^https?:\/\//, '')
</script>

<template>
  <PageHeader title="Upstreams">
    <AutoRefresh v-model="refreshRate" />
    <Button as-child><NuxtLink to="/upstreams/new">+ Upstream hinzufügen</NuxtLink></Button>
  </PageHeader>

  <section aria-label="Filter" class="flex flex-wrap items-center gap-2">
    <label for="q" class="sr-only">Upstreams suchen</label>
    <Input id="q" v-model="q" type="search" placeholder="Name oder URL suchen" class="w-60" />
    <Select v-model="statusFilter">
      <SelectTrigger class="w-44" aria-label="Status filtern"><SelectValue placeholder="Status" /></SelectTrigger>
      <SelectContent><SelectItem value="all">Alle Status</SelectItem><SelectItem v-for="h in HEALTH_VALUES" :key="h" :value="h">{{ healthLabel(h) }}</SelectItem></SelectContent>
    </Select>
    <Select v-model="typeFilter">
      <SelectTrigger class="w-36" aria-label="Typ filtern"><SelectValue placeholder="Typ" /></SelectTrigger>
      <SelectContent><SelectItem value="all">Alle Typen</SelectItem><SelectItem value="http">HTTP</SelectItem><SelectItem value="stdio">stdio</SelectItem><SelectItem value="rest">REST</SelectItem></SelectContent>
    </Select>
  </section>

  <section v-if="items.length" aria-label="Kennzahlen" class="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-3">
    <KpiCard v-for="c in counts" :key="c.h" :label="healthLabel(c.h)" :value="String(c.n)" unit="Upstreams" :dot="`var(--st-${c.h}-dot)`" :share="items.length ? c.n / items.length : 0" />
  </section>

  <DataSection min-width="1040px">
    <LoadingRows v-if="status === 'pending' && !data" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <EmptyState v-else-if="!items.length" title="Noch kein Upstream" text="Ein Upstream ist ein MCP-Server, den du über mcpwarden bereitstellst. 1. Upstream anlegen. 2. Anmeldedaten eintragen. 3. Verbindung testen.">
      <Button as-child><NuxtLink to="/upstreams/new">+ Upstream hinzufügen</NuxtLink></Button>
    </EmptyState>
    <EmptyState v-else-if="!filtered.length" title="Keine Treffer" text="Kein Upstream passt zu den Filtern." />
    <table v-else class="w-full text-sm">
      <caption class="sr-only">Upstream-Liste</caption>
      <thead class="bg-table-head text-xs font-medium text-muted-foreground">
        <tr class="border-b">
          <th scope="col" class="px-5 py-2.5 text-left font-medium">Name</th><th scope="col" class="px-3 text-left font-medium">Status</th><th scope="col" class="px-3 text-left font-medium">Typ</th>
          <th scope="col" class="px-3 text-left font-medium">Tools</th><th v-if="hasP95" scope="col" class="px-3 text-left font-medium">p95</th><th v-if="hasRecent" scope="col" class="px-3 text-left font-medium">Letzte 24 Aufrufe</th>
          <th scope="col" class="px-3 text-left font-medium">Meldung</th><th scope="col" class="px-5 text-right font-medium"><span class="sr-only">Aktionen</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in filtered" :key="u.id" class="border-b border-muted">
          <td class="px-5 py-2"><NuxtLink :to="`/upstreams/${u.id}`" class="flex items-center gap-3 hover:underline">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-sm border bg-muted font-semibold text-secondary-foreground" aria-hidden="true">{{ u.name[0]?.toUpperCase() }}</span>
            <span class="min-w-0"><span class="block font-semibold">{{ u.name }}</span><span class="mono block max-w-72 truncate text-xs text-muted-foreground">{{ sub(u) }}</span></span>
          </NuxtLink></td>
          <td class="px-3"><StatusBadge :status="u.status" :setup="u.setup" /></td>
          <td class="px-3 text-secondary-foreground">{{ typeLabel(u.type) }}</td>
          <td class="tnum px-3">{{ u.toolsEnabled }} / {{ u.toolsTotal }}</td>
          <td v-if="hasP95" class="tnum px-3">{{ formatMs(u.p95Ms) }}</td>
          <td v-if="hasRecent" class="px-3"><SparkBars v-if="u.recent" :items="u.recent" /></td>
          <td class="min-w-56 px-3 text-[13px] text-secondary-foreground">{{ message(u) }}</td>
          <td class="px-5 text-right whitespace-nowrap">
            <Button variant="ghost" size="icon" :disabled="testing === u.id" :aria-label="`Verbindung testen: ${u.name}`" @click="runTest(u)"><RefreshCw class="size-[18px]" :class="testing === u.id && 'animate-spin'" aria-hidden="true" /></Button>
            <Button as-child variant="ghost" size="icon" :aria-label="`Bearbeiten: ${u.name}`"><NuxtLink :to="`/upstreams/${u.id}/edit`"><Pencil class="size-[18px]" aria-hidden="true" /></NuxtLink></Button>
          </td>
        </tr>
      </tbody>
    </table>
    <template v-if="filtered.length" #footer><span>Zeige {{ filtered.length }} von {{ items.length }}</span></template>
  </DataSection>
</template>
