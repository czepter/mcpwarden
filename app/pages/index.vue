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
import PageHeader from '~/components/shell/PageHeader.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { formatNumber } from '~/lib/format'
import { healthLabel, setupLabel } from '~/lib/labels'

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
const attentionColor = (a: { status: string, setup: string }) => (a.status === 'degraded' && a.setup === 'ready' ? 'var(--st-degraded-fg)' : 'var(--st-open-fg)')
</script>

<template>
  <PageHeader :title="$t('dashboard.title')"><TimeWindow v-model="win" variant="menu" /><AutoRefresh v-model="rate" /></PageHeader>
  <p v-if="adminHint" role="status" class="rounded-sm border border-warn-border bg-warn-bg px-3 py-2 text-[13px] text-warn-fg">{{ $t('dashboard.adminOnly') }}</p>
  <LoadingRows v-if="status === 'pending' && !data" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
  <template v-else-if="data">
    <section v-if="k" :aria-label="$t('dashboard.kpis')" class="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
      <KpiCard :label="$t('dashboard.kpiClientsActive')" :value="String(k.clientsActive)" :unit="$t('dashboard.kpiClientsOf', { total: k.clientsTotal })" :note="$t('dashboard.kpiClientsNote')" />
      <KpiCard :label="$t('dashboard.kpiCallsPerMin')" :value="formatNumber(k.callsPerMin, 1)" :unit="$t('dashboard.perMin')" :note="$t('dashboard.kpiCallsNote')" />
      <KpiCard :label="$t('dashboard.kpiSuccessRate')" :value="formatNumber(k.successRate * 100, 1)" unit="%" :note="winNote" note-class="text-st-healthy-fg" />
      <KpiCard :label="$t('dashboard.kpiOverhead')" :value="formatNumber(k.overheadP95Ms)" unit="ms" :note="$t('dashboard.kpiOverheadNote')" note-class="text-st-healthy-fg" />
    </section>

    <!-- Desktop: clients table left, attention card and chart right (draft); mobile: attention, table, chart. -->
    <div :class="data.clients.length ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,1fr)]' : 'contents'">
    <DataSection v-if="data.attention.length" :title="$t('dashboard.attention')" :class="data.clients.length && 'lg:col-start-2 lg:row-start-1'">
      <ul class="flex flex-col px-5 pb-4">
        <li v-for="a in data.attention" :key="a.upstreamId" class="border-t border-muted first:border-t-0">
          <NuxtLink :to="`/upstreams/${a.upstreamId}`" class="flex min-h-11 flex-col justify-center gap-0.5 py-1.5 no-underline">
            <span class="flex flex-wrap items-center gap-2 font-semibold"><span class="size-2 rounded-full" :style="{ background: attentionColor(a) }" aria-hidden="true" />{{ a.name }}<span class="text-[13px] font-medium" data-testid="status-badge" :style="{ color: attentionColor(a) }">{{ a.setup !== 'ready' ? setupLabel(a.setup) : healthLabel(a.status) }}</span></span>
            <span class="text-[13px] text-secondary-foreground">{{ a.statusReason }}</span>
          </NuxtLink>
          <NuxtLink v-if="a.setup === 'awaiting_auth'" :to="`/upstreams/${a.upstreamId}?tab=auth`" class="mb-2 inline-block text-[13px] font-medium text-primary underline">{{ $t('dashboard.enterCredentials') }}</NuxtLink>
          <NuxtLink v-else-if="a.setup === 'awaiting_approval'" :to="`/upstreams/${a.upstreamId}/approve`" class="mb-2 inline-block text-[13px] font-medium text-primary underline">{{ $t('dashboard.reviewDraft') }}</NuxtLink>
          <NuxtLink v-else-if="a.status === 'auth_expired'" :to="`/upstreams/${a.upstreamId}?tab=auth`" class="mb-2 inline-block text-[13px] font-medium text-primary underline">{{ $t('dashboard.reconnect') }}</NuxtLink>
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
        <thead class="bg-table-head text-xs text-muted-foreground"><tr class="border-y"><th scope="col" class="px-5 py-2.5 text-left font-medium">{{ $t('dashboard.colClient') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('dashboard.colSignIn') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('dashboard.colStatus') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('dashboard.colCalls') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('dashboard.colTools') }}</th><th scope="col" class="px-5 text-right font-medium">{{ $t('dashboard.colAction') }}</th></tr></thead>
        <tbody>
          <tr v-for="c in data.clients" :key="`${c.kind}-${c.id}`" class="border-b border-muted">
            <td class="px-5 py-2"><div class="flex flex-wrap items-center gap-2"><span class="font-semibold">{{ c.name }}</span><Badge v-if="c.allowlisted === false" class="border-transparent bg-warn-bg text-warn-fg">{{ $t('dashboard.notAllowlisted') }}</Badge></div><div class="text-xs text-muted-foreground">{{ c.deviceName ? $t('dashboard.subDevice', { device: c.deviceName, kind: c.kind === 'oauth' ? $t('dashboard.subOauth') : $t('dashboard.subToken') }) : (c.kind === 'oauth' ? $t('dashboard.subOauth') : $t('dashboard.subToken')) }}</div></td>
            <td class="px-3 text-secondary-foreground">{{ c.kind === 'oauth' ? 'OAuth' : $t('dashboard.kindToken') }}</td>
            <td class="px-3"><div class="flex items-center gap-2 font-medium" :class="c.active ? 'text-st-healthy-fg' : 'text-secondary-foreground'"><span class="size-2 rounded-full" :class="c.active ? 'bg-st-healthy-bar' : 'bg-st-disabled-dot'" aria-hidden="true" />{{ c.active ? $t('dashboard.online') : $t('dashboard.inactive') }}</div><div class="text-xs text-muted-foreground"><RelativeTime :value="c.lastActiveAt" :empty="$t('dashboard.noCall')" /></div></td>
            <td class="tnum px-3">{{ $t('dashboard.callsPerMinCell', { n: formatNumber(c.callsPerMin, c.callsPerMin < 10 && c.callsPerMin % 1 ? 1 : 0) }) }}</td>
            <td class="tnum px-3 text-secondary-foreground">{{ c.contextTokensEstimate == null ? '–' : $t(c.toolMode === 'meta' ? 'dashboard.contextTokensMeta' : 'dashboard.contextTokens', { n: formatNumber(c.contextTokensEstimate) }) }}</td>
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
