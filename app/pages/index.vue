<script setup lang="ts">
import { toast } from 'vue-sonner'
import { dashboardApi, meApi } from '~/api'
import type { DashboardClient, StatsWindow } from '#shared/api-types'
import AutoRefresh from '~/components/common/AutoRefresh.vue'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import CopyButton from '~/components/common/CopyButton.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LineChart from '~/components/common/LineChart.vue'
import TimeWindow from '~/components/common/TimeWindow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import StatusDot from '~/components/common/StatusDot.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { formatNumber, formatPercent } from '~/lib/format'

const { t } = useI18n()
useHead({ title: () => `${t('dashboard.title')} · mcpwarden` })
const route = useRoute()
const adminHint = computed(() => route.query.hinweis === 'admin')
// Time window of the key figures and the chart (draft: "Letzte Stunde"); kept in the query.
const router = useRouter()
const WINDOWS: StatsWindow[] = ['5m', '1h', '24h', '7d']
const win = ref<StatsWindow>(WINDOWS.find(w => w === route.query.window) ?? '1h')
watch(win, (w) => { void router.replace({ query: { ...route.query, window: w === '1h' ? undefined : w } }) })
const { data, error, status, refresh } = useAsyncData('dashboard', () => dashboardApi.get(win.value), { server: false, lazy: true, watch: [win] })
const winText = computed(() => ({ '5m': t('stats.win5m'), '1h': t('stats.win1h'), '24h': t('stats.win24h'), '7d': t('stats.win7d') })[win.value])
const winNote = computed(() => ({ '5m': t('stats.window5m'), '1h': t('stats.window1h'), '24h': t('stats.window24h'), '7d': t('stats.window7d') })[win.value])
const series = computed(() => (data.value?.series ?? []).map(p => ({ t: p.t, v: p.calls })))
const seriesPeak = computed(() => Math.max(0, ...series.value.map(p => p.v)))
const caps = useApi('caps', meApi.capabilities)
const rate = ref(0)
usePolling(refresh, rate)
const cmd = computed(() => `claude mcp add --transport http mcpwarden ${caps.data.value?.mcpUrl ?? ''}`)
const revoke = ref<DashboardClient | null>(null)
async function doRevoke() {
  const c = revoke.value; if (!c) return
  try { if (c.kind === 'oauth') await meApi.revokeConnection(c.id); else await meApi.revokePat(c.id); toast.success(t('dashboard.revoked')); await refresh() } catch { toast.error(t('dashboard.revokeFailed')) }
  revoke.value = null
}
const k = computed(() => data.value?.kpis)
</script>

<template>
  <PageHeader :title="$t('dashboard.title')"><TimeWindow v-model="win" /><AutoRefresh v-model="rate" /></PageHeader>
  <p v-if="adminHint" role="status" class="rounded-sm border border-warn-border bg-warn-bg px-3 py-2 text-[13px] text-warn-fg">{{ $t('dashboard.adminOnly') }}</p>
  <LoadingRows v-if="status === 'pending' && !data" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
  <template v-else-if="data">
    <section v-if="k" :aria-label="$t('dashboard.kpis')" class="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
      <KpiCard :label="$t('dashboard.kpiClientsActive')" :value="$t('dashboard.kpiClientsValue', { active: k.clientsActive, total: k.clientsTotal })" :note="$t('dashboard.kpiClientsNote')" />
      <KpiCard :label="$t('dashboard.kpiCallsPerMin')" :value="formatNumber(k.callsPerMin, 1)" />
      <KpiCard :label="$t('dashboard.kpiSuccessRate')" :value="formatPercent(k.successRate)" :note="winNote" />
      <KpiCard :label="$t('dashboard.kpiOverhead')" :value="formatNumber(k.overheadP95Ms)" unit="ms" :note="$t('dashboard.kpiOverheadNote')" />
    </section>

    <!-- Desktop: clients table left, attention card and chart right (draft); mobile: attention, table, chart. -->
    <div :class="data.clients.length ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]' : 'contents'">
    <DataSection v-if="data.attention.length" :title="$t('dashboard.attention')" :class="data.clients.length && 'lg:col-start-2 lg:row-start-1'">
      <ul class="divide-y">
        <li v-for="a in data.attention" :key="a.upstreamId" class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div class="flex items-center gap-3"><StatusBadge :status="a.status" :setup="a.setup" /><NuxtLink :to="`/upstreams/${a.upstreamId}`" class="font-semibold hover:underline">{{ a.name }}</NuxtLink><span class="text-[13px] text-secondary-foreground">{{ a.statusReason }}</span></div>
          <Button v-if="a.setup === 'awaiting_auth'" as-child variant="outline"><NuxtLink :to="`/upstreams/${a.upstreamId}?tab=auth`">{{ $t('dashboard.enterCredentials') }}</NuxtLink></Button>
          <Button v-else-if="a.setup === 'awaiting_approval'" as-child variant="outline"><NuxtLink :to="`/upstreams/${a.upstreamId}/approve`">{{ $t('dashboard.reviewDraft') }}</NuxtLink></Button>
          <Button v-else-if="a.status === 'auth_expired'" as-child variant="outline"><NuxtLink :to="`/upstreams/${a.upstreamId}?tab=auth`">{{ $t('dashboard.reconnect') }}</NuxtLink></Button>
        </li>
      </ul>
    </DataSection>

    <template v-if="!data.clients.length">
    <div class="rounded-lg border bg-card">
      <EmptyState :title="$t('dashboard.emptyTitle')" :text="$t('dashboard.emptyText')">
        <code class="mono rounded-sm bg-muted px-2 py-1 text-xs" data-testid="mcp-url">{{ caps.data.value?.mcpUrl }}</code>
        <CopyButton v-if="caps.data.value" :value="caps.data.value.mcpUrl" :label="$t('dashboard.copyUrl')" />
        <div class="basis-full" />
        <code class="mono rounded-sm bg-muted px-2 py-1 text-xs" data-testid="setup-cmd">{{ cmd }}</code>
        <CopyButton v-if="caps.data.value" :value="cmd" :label="$t('dashboard.copyCommand')" />
        <p class="basis-full text-[13px] text-muted-foreground"><i18n-t keypath="dashboard.withoutOauth" tag="span"><template #link><NuxtLink to="/settings/tokens" class="text-primary underline">{{ $t('dashboard.tokensLink') }}</NuxtLink></template></i18n-t></p>
      </EmptyState>
    </div>
    <!-- Page empty state stays as before, including the "nothing to do" note; the attention card above only exists with items. -->
    <DataSection v-if="!data.attention.length" :title="$t('dashboard.attention')">
      <p class="px-5 pb-4 text-[13px]" data-testid="nothing-to-do">{{ $t('dashboard.nothingToDo') }}</p>
    </DataSection>
    </template>
    <DataSection v-else :title="$t('dashboard.connectedClients')" min-width="760px" class="lg:col-start-1 lg:row-start-1 lg:row-span-2">
      <template #actions><NuxtLink to="/settings/connections" class="text-[13px] text-primary underline">{{ $t('dashboard.allClientsAndTokens') }}</NuxtLink></template>
      <table class="w-full text-sm">
        <caption class="sr-only">{{ $t('dashboard.connectedClients') }}</caption>
        <thead class="bg-table-head text-xs text-muted-foreground"><tr class="border-y"><th scope="col" class="px-5 py-2.5 text-left font-medium">{{ $t('dashboard.colClient') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('dashboard.colSignIn') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('dashboard.colStatus') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('dashboard.colLastActive') }}</th><th scope="col" class="px-3 text-right font-medium">{{ $t('dashboard.colCallsPerMin') }}</th><th scope="col" class="px-3 text-right font-medium">{{ $t('dashboard.colTools') }}</th><th scope="col" class="px-5"><span class="sr-only">{{ $t('dashboard.colActions') }}</span></th></tr></thead>
        <tbody>
          <tr v-for="c in data.clients" :key="`${c.kind}-${c.id}`" class="border-b border-muted">
            <td class="px-5 py-2 font-medium">{{ c.name }}<Badge v-if="c.allowlisted === false" variant="outline" class="ml-2">{{ $t('dashboard.notAllowlisted') }}</Badge></td>
            <td class="px-3">{{ c.kind === 'oauth' ? 'OAuth' : $t('dashboard.kindToken') }}</td>
            <td class="px-3"><StatusDot :active="c.active" /></td>
            <td class="px-3"><RelativeTime :value="c.lastActiveAt" :empty="$t('dashboard.never')" /></td>
            <td class="tnum px-3 text-right">{{ formatNumber(c.callsPerMin) }}</td>
            <td class="tnum px-3 text-right">{{ c.contextTokensEstimate == null ? '–' : $t('dashboard.contextTokens', { n: formatNumber(c.contextTokensEstimate) }) }}</td>
            <td class="px-5 text-right"><Button variant="destructive-outline" :aria-label="$t('dashboard.revokeLabel', { name: c.name })" @click="revoke = c">{{ $t('dashboard.revoke') }}</Button></td>
          </tr>
        </tbody>
      </table>
    </DataSection>
    <DataSection v-if="data.clients.length && k" :title="$t('dashboard.callsPerMinChart')" class="lg:col-start-2" :class="data.attention.length ? 'lg:row-start-2' : 'lg:row-start-1'">
      <figure class="px-5 pb-4">
        <LineChart :points="series" :label="$t('dashboard.callsPerMinAria', { window: winText, peak: formatNumber(seriesPeak, 1) })" :start="winText" :end="$t('stats.now')" />
      </figure>
    </DataSection>
    </div>
    <ConfirmDialog :open="!!revoke" :title="$t('dashboard.confirmTitle')" :confirm-label="$t('dashboard.revoke')" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
      {{ revoke?.kind === 'oauth' ? $t('dashboard.confirmBodyOauth', { name: revoke?.name }) : $t('dashboard.confirmBodyToken', { name: revoke?.name }) }}
    </ConfirmDialog>
  </template>
</template>
