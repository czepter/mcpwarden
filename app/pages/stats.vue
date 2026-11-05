<script setup lang="ts">
import type { StatsWindow } from '#shared/api-types'
import { statsApi } from '~/api'
import DataSection from '~/components/common/DataSection.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import TimeWindow from '~/components/common/TimeWindow.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { formatNumber, formatPercent } from '~/lib/format'
import { outcomeLabel } from '~/lib/labels'

definePageMeta({ middleware: 'phase2' })
useHead({ title: 'Statistik · mcpwarden' })
const win = ref<StatsWindow>('24h')
const { data, error, status, refresh } = useAsyncData('stats', () => statsApi.summary(win.value), { server: false, watch: [win] })
const max = computed(() => Math.max(1, ...(data.value?.perHour.map(p => p.calls) ?? [])))
const total = computed(() => data.value?.outcomes.reduce((a, o) => a + o.count, 0) || 1)
// Y-Achse: Gitterlinien auf runden Werten, Hoehe proportional zum Wert (Abgleich Punkt 27).
const ticks = computed(() => { const step = Math.pow(10, Math.floor(Math.log10(max.value))); const top = Math.ceil(max.value / step) * step; return [0, top / 2, top] })
const top = computed(() => ticks.value[2]!)
</script>

<template>
  <PageHeader title="Statistik"><TimeWindow v-model="win" /></PageHeader>
  <LoadingRows v-if="status === 'pending' && !data" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
  <template v-else-if="data">
    <section aria-label="Kennzahlen" class="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3">
      <KpiCard label="Aufrufe gesamt" :value="formatNumber(data.calls)" />
      <KpiCard label="Pro Minute" :value="formatNumber(data.callsPerMin, 1)" />
      <KpiCard label="Erfolgsquote" :value="formatPercent(data.okRate)" />
      <KpiCard label="Spitze gleichzeitig" :value="String(data.peakConcurrent)" />
      <KpiCard label="Aktive Clients" :value="String(data.activeClients)" />
    </section>
    <DataSection title="Aufrufe pro Stunde">
      <figure class="px-5 pb-4" role="img" :aria-label="`Aufrufe pro Stunde, Spitze ${formatNumber(max)}`">
        <div class="relative flex h-40 items-end gap-1 border-b border-l pl-1">
          <div v-for="t in ticks" :key="t" class="absolute right-0 left-0 border-t border-dashed border-border text-[10px] text-muted-foreground" :style="{ bottom: `${(t / top) * 100}%` }"><span class="absolute -top-3 left-1 bg-card tnum">{{ formatNumber(t) }}</span></div>
          <div v-for="p in data.perHour" :key="p.t" class="z-10 flex-1 rounded-t-[2px] bg-primary" :style="{ height: `${(p.calls / top) * 100}%` }" :title="`${formatNumber(p.calls)} Aufrufe`" />
        </div>
      </figure>
    </DataSection>
    <DataSection title="Ergebnis der Aufrufe">
      <ul class="flex flex-col gap-2 px-5 pb-4">
        <li v-for="o in data.outcomes" :key="o.outcome" class="grid grid-cols-[130px_1fr_70px] items-center gap-3 text-sm">
          <span :title="o.outcome">{{ outcomeLabel(o.outcome) }}</span>
          <span class="h-2 rounded-sm bg-muted" aria-hidden="true"><span class="block h-2 rounded-sm" :class="o.outcome === 'ok' ? 'bg-[#16a34a]' : 'bg-[#d97706]'" :style="{ width: `${(o.count / total) * 100}%` }" /></span>
          <span class="tnum text-right">{{ formatNumber(o.count) }}</span>
        </li>
      </ul>
    </DataSection>
    <DataSection title="Je Upstream" min-width="860px">
      <table class="w-full text-sm">
        <caption class="sr-only">Statistik je Upstream</caption>
        <thead class="bg-table-head text-xs text-muted-foreground"><tr class="border-y"><th scope="col" class="px-5 py-2.5 text-left font-medium">Upstream</th><th v-for="h in ['Aufrufe', 'Erfolg', 'p5', 'p50', 'p75', 'p95', 'p99', 'Overhead p95']" :key="h" scope="col" class="px-3 text-right font-medium">{{ h }}</th></tr></thead>
        <tbody>
          <tr v-for="r in data.rows" :key="r.upstream" class="tnum border-b border-muted">
            <td class="px-5 py-2 font-medium">{{ r.upstream }}</td><td class="px-3 text-right">{{ formatNumber(r.calls) }}</td><td class="px-3 text-right">{{ formatPercent(r.okRate) }}</td>
            <td v-for="v in [r.p5Ms, r.p50Ms, r.p75Ms, r.p95Ms, r.p99Ms, r.overheadP95Ms]" :key="v" class="px-3 text-right">{{ formatNumber(v) }} ms</td>
          </tr>
        </tbody>
      </table>
    </DataSection>
  </template>
</template>
