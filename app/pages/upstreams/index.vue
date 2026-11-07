<script setup lang="ts">
import type { StatsWindow, UpstreamTestResult as TestResultT, UpstreamSummary } from '#shared/api-types'
import { toast } from 'vue-sonner'
import { upstreamApi } from '~/api'
import AutoRefresh from '~/components/common/AutoRefresh.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import TimeWindow from '~/components/common/TimeWindow.vue'
import SparkBars from '~/components/common/SparkBars.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { RefreshCw, Pencil } from '@lucide/vue'
import { formatCountdown, formatMs } from '~/lib/format'
import { HEALTH_VALUES, healthLabel, typeLabel } from '~/lib/labels'

const { t } = useI18n()
useHead({ title: () => `${t('upstreams.list.title')} · mcpwarden` })
// Time window (U4): only the p95 column depends on it; kept in the query so reloads and links keep it.
const route = useRoute()
const router = useRouter()
const WINDOWS: StatsWindow[] = ['5m', '1h', '24h', '7d']
const win = ref<StatsWindow>(WINDOWS.find(w => w === route.query.window) ?? '7d')
watch(win, (w) => { void router.replace({ query: { ...route.query, window: w === '7d' ? undefined : w } }) })
const { data, error, status, refresh } = useAsyncData('upstreams', () => upstreamApi.list(win.value), { server: false, lazy: true, watch: [win] })
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
    if (r.ok) toast.success(t('upstreams.list.toolsFound', { name: u.name, n: r.tools.length }, r.tools.length)); else toast.error(`${u.name}: ${r.message}`)
    await refresh()
  } catch { toast.error(t('upstreams.toast.testFailed')) } finally { testing.value = null }
}
const message = (u: UpstreamSummary) => {
  if (u.status === 'open' && u.nextRetryAt) return t('upstreams.list.breakerOpen', { time: formatCountdown(u.nextRetryAt) })
  if (u.setup !== 'ready') return u.setup === 'awaiting_auth' ? t('upstreams.list.awaitingAuth') : t('upstreams.list.awaitingApproval')
  return u.statusReason ?? ''
}
const sub = (u: UpstreamSummary) => (u.url ?? u.command ?? '').replace(/^https?:\/\//, '')
</script>

<template>
  <PageHeader :title="$t('upstreams.list.title')">
    <TimeWindow v-model="win" />
    <AutoRefresh v-model="refreshRate" />
    <Button as-child><NuxtLink to="/upstreams/new">{{ $t('upstreams.list.add') }}</NuxtLink></Button>
  </PageHeader>

  <section :aria-label="$t('upstreams.list.filter')" class="flex flex-wrap items-center gap-2">
    <label for="q" class="sr-only">{{ $t('upstreams.list.searchLabel') }}</label>
    <Input id="q" v-model="q" type="search" :placeholder="$t('upstreams.list.searchPlaceholder')" class="w-60" />
    <Select v-model="statusFilter">
      <SelectTrigger class="w-44" :aria-label="$t('upstreams.list.filterStatus')"><SelectValue :placeholder="$t('upstreams.list.status')" /></SelectTrigger>
      <SelectContent><SelectItem value="all">{{ $t('upstreams.list.allStatuses') }}</SelectItem><SelectItem v-for="h in HEALTH_VALUES" :key="h" :value="h">{{ healthLabel(h) }}</SelectItem></SelectContent>
    </Select>
    <Select v-model="typeFilter">
      <SelectTrigger class="w-36" :aria-label="$t('upstreams.list.filterType')"><SelectValue :placeholder="$t('upstreams.list.type')" /></SelectTrigger>
      <SelectContent><SelectItem value="all">{{ $t('upstreams.list.allTypes') }}</SelectItem><SelectItem value="http">HTTP</SelectItem><SelectItem value="stdio">stdio</SelectItem></SelectContent>
    </Select>
  </section>

  <section v-if="items.length" :aria-label="$t('upstreams.list.kpis')" class="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-3">
    <KpiCard v-for="c in counts" :key="c.h" :label="healthLabel(c.h)" :value="String(c.n)" :unit="$t('upstreams.list.kpiUnit')" :dot="`var(--st-${c.h}-dot)`" :share="items.length ? c.n / items.length : 0" />
  </section>

  <p v-if="items.length" class="text-sm font-semibold">{{ $t('upstreams.list.count', { n: items.length }, items.length) }}</p>
  <DataSection min-width="1040px">
    <LoadingRows v-if="status === 'pending' && !data" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <EmptyState v-else-if="!items.length" :title="$t('upstreams.list.emptyTitle')" :text="$t('upstreams.list.emptyText')">
      <Button as-child><NuxtLink to="/upstreams/new">{{ $t('upstreams.list.add') }}</NuxtLink></Button>
    </EmptyState>
    <EmptyState v-else-if="!filtered.length" :title="$t('upstreams.list.noMatchTitle')" :text="$t('upstreams.list.noMatchText')" />
    <table v-else class="w-full text-sm">
      <caption class="sr-only">{{ $t('upstreams.list.caption') }}</caption>
      <thead class="bg-table-head text-xs font-medium text-muted-foreground">
        <tr class="border-b">
          <th scope="col" class="px-5 py-2.5 text-left font-medium">{{ $t('upstreams.list.colName') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('upstreams.list.colStatus') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('upstreams.list.colType') }}</th>
          <th scope="col" class="px-3 text-left font-medium">{{ $t('upstreams.list.colTools') }}</th><th v-if="hasP95" scope="col" class="px-3 text-left font-medium">p95</th><th v-if="hasRecent" scope="col" class="px-3 text-left font-medium">{{ $t('upstreams.list.colRecent') }}</th>
          <th scope="col" class="px-3 text-left font-medium">{{ $t('upstreams.list.colMessage') }}</th><th scope="col" class="px-3 text-right font-medium"><span class="sr-only">{{ $t('upstreams.list.colActions') }}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="u in filtered" :key="u.id" class="border-b border-muted">
          <td class="px-5 py-2"><NuxtLink :to="`/upstreams/${u.id}`" class="flex min-h-11 items-center gap-3 hover:underline">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-sm border bg-muted font-semibold text-secondary-foreground" aria-hidden="true">{{ u.name[0]?.toUpperCase() }}</span>
            <span class="min-w-0"><span class="block font-semibold">{{ u.name }}</span><span class="mono block max-w-52 truncate text-xs text-muted-foreground">{{ sub(u) }}</span></span>
          </NuxtLink></td>
          <td class="px-3"><StatusBadge :status="u.status" :setup="u.setup" /></td>
          <td class="px-3 text-secondary-foreground">{{ typeLabel(u.type) }}</td>
          <td class="tnum px-3">{{ u.toolsEnabled }} / {{ u.toolsTotal }}</td>
          <td v-if="hasP95" class="tnum px-3">{{ formatMs(u.p95Ms) }}</td>
          <td v-if="hasRecent" class="px-3"><SparkBars v-if="u.recent" :items="u.recent" /></td>
          <td class="min-w-44 px-3 text-[13px] text-secondary-foreground">{{ message(u) }}</td>
          <td class="px-3 text-right whitespace-nowrap">
            <Button variant="ghost" size="icon" :disabled="testing === u.id" :aria-label="$t('upstreams.list.testAria', { name: u.name })" @click="runTest(u)"><RefreshCw class="size-[18px]" :class="testing === u.id && 'animate-spin'" aria-hidden="true" /></Button>
            <Button as-child variant="ghost" size="icon" :aria-label="$t('upstreams.list.editAria', { name: u.name })"><NuxtLink :to="`/upstreams/${u.id}/edit`"><Pencil class="size-[18px]" aria-hidden="true" /></NuxtLink></Button>
          </td>
        </tr>
      </tbody>
    </table>
    <template v-if="filtered.length" #footer><span>{{ $t('upstreams.list.showing', { shown: filtered.length, total: items.length }) }}</span></template>
  </DataSection>
</template>
