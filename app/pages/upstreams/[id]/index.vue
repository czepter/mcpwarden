<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import type { UpstreamTestResult as TestResultT } from '#shared/api-types'
import { toast } from 'vue-sonner'
import { meApi, upstreamApi } from '~/api'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import FormRow from '~/components/common/FormRow.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import SecretField from '~/components/common/SecretField.vue'
import SparkBars from '~/components/common/SparkBars.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import PercentileChart from '~/components/upstreams/PercentileChart.vue'
import StatusHistory from '~/components/upstreams/StatusHistory.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import TestResult from '~/components/upstreams/TestResult.vue'
import ToolTable from '~/components/upstreams/ToolTable.vue'
import { formatCountdown, formatMs, formatNumber, formatPercent } from '~/lib/format'
import { authTypeLabel, outcomeLabel, typeLabel } from '~/lib/labels'
import { useZodForm } from '~/lib/useZodForm'
import { secretSchema } from '~/lib/zod-schemas'

const { t } = useI18n()
const route = useRoute()
const id = String(route.params.id)
const up = useApi(`up-${id}`, () => upstreamApi.get(id))
const tools = useApi(`tools-${id}`, () => upstreamApi.tools(id))
const tab = computed({ get: () => (['tools', 'auth'].includes(String(route.query.tab)) ? String(route.query.tab) : 'overview'), set: v => navigateTo({ query: { tab: v === 'overview' ? undefined : v } }, { replace: true }) })
const u = computed(() => up.data.value)

// Statistics (spec P0-15): key figures and curves over 24 h with the 7-day baseline; availability and heatmap only when the
// backend offers the history (`features.healthHistory`). A failing statistics call never hides the rest of the page.
const caps = useApi('caps', meApi.capabilities)
const st = useApi(`stats-${id}`, () => upstreamApi.stats(id, '24h'))
const hasHistory = computed(() => caps.data.value?.features?.healthHistory === true)
const history = useAsyncData(`history-${id}`, () => (hasHistory.value ? upstreamApi.healthHistory(id) : Promise.resolve(null)), { server: false, lazy: true, watch: [hasHistory] })
const list = useAsyncData('upstreams-side', () => upstreamApi.list(), { server: false, lazy: true })
const toolStats = computed(() => Object.fromEntries((st.data.value?.tools ?? []).map(x => [x.name, { errorRate: x.errorRate, p95Ms: x.p95Ms }])))
const p95Slow = computed(() => !!st.data.value && st.data.value.baseline.p95Ms > 0 && st.data.value.p95Ms > 3 * st.data.value.baseline.p95Ms)
const maxErr = computed(() => Math.max(1, ...(st.data.value?.errors.map(e => e.count) ?? [])))
const fmtSeconds = (ms: number) => (ms >= 1000 ? `${formatNumber(ms / 1000, 1)} s` : `${formatNumber(ms)} ms`)
useHead(() => ({ title: `${u.value?.name ?? t('upstreams.detail.fallbackTitle')} · mcpwarden` }))

const test = ref<TestResultT | null>(null)
const testing = ref(false)
async function runTest() {
  testing.value = true
  try { test.value = await upstreamApi.test(id); await Promise.all([up.refresh(), tools.refresh()]) } catch { toast.error(t('upstreams.toast.testFailed')) } finally { testing.value = false }
}
async function toggleEnabled() { if (!u.value) return; try { await upstreamApi.patch(id, { enabled: !u.value.enabled }); await up.refresh() } catch { toast.error(t('upstreams.detail.saveFailed')) } }
const del = ref(false)
async function doDelete() { try { await upstreamApi.remove(id); toast.success(t('upstreams.detail.deleted')); await navigateTo('/upstreams') } catch { toast.error(t('upstreams.detail.deleteFailed')) } del.value = false }

const sec = useZodForm(secretSchema, { value: '' })
const [secret] = sec.form.defineField('value')
const replaced = ref(false)
const saveSecret = sec.submit(async (v) => {
  try { await upstreamApi.putSecret(id, { kind: u.value?.authType === 'header' ? 'header' : 'bearer', name: u.value?.authHeaderName ?? undefined, value: v.value }) } finally { sec.form.resetForm({ values: { value: '' } }) }
  replaced.value = true; await up.refresh(); toast.success(t('upstreams.detail.secretToast'))
}, ['value'])
// OAuth against the upstream: the browser leaves for the upstream's authorization server and returns with ?oauth=ok|denied|error
const connecting = ref(false)
async function oauthConnect() {
  connecting.value = true
  try {
    const r = await upstreamApi.oauthStart(id)
    if (r.authorizationUrl) { window.location.href = r.authorizationUrl; return }
    await up.refresh(); toast.success(t('upstreams.oauth.connected'))
  } catch { toast.error(t('upstreams.oauth.startFailed')) } finally { connecting.value = false }
}
async function oauthDisconnect() {
  try { await upstreamApi.oauthDisconnect(id); await up.refresh(); toast.success(t('upstreams.oauth.disconnected')) } catch { toast.error(t('upstreams.oauth.disconnectFailed')) }
}
onMounted(async () => {
  const r = String(route.query.oauth ?? '')
  if (!r) return
  await navigateTo({ query: { tab: 'auth' } }, { replace: true })
  if (r === 'ok') { toast.success(t('upstreams.oauth.connected')); await runTest() } else toast.error(t(r === 'denied' ? 'upstreams.oauth.denied' : 'upstreams.oauth.failed'))
})
// Tabs as in the draft: underline in the accent color, 44 px high.
const TABS = computed(() => [['overview', t('upstreams.detail.tabOverview')], ['tools', t('upstreams.detail.tabTools')], ['auth', t('upstreams.detail.tabAuth')]] as const)
const TAB_CLASS = '-mb-px h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 text-secondary-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:border-b-primary dark:data-[state=active]:bg-transparent'
const sideTab = computed(() => (tab.value === 'overview' ? undefined : tab.value))
const saveTool = (name: string, enabled: boolean) => upstreamApi.setTool(id, name, enabled)
</script>

<template>
  <ErrorState v-if="up.error.value" :error="up.error.value" @retry="up.refresh()" />
  <LoadingRows v-else-if="!u" :rows="5" />
  <template v-else>
    <!-- Side list (T1): all upstreams with their last 24 hours; only with the status history, on wide screens. -->
    <div :class="hasHistory && list.data.value ? 'grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]' : 'contents'">
    <aside v-if="hasHistory && list.data.value" :aria-label="$t('upstreams.stats.sideList')" class="hidden flex-col gap-1 rounded-lg border bg-card p-2 lg:flex">
      <NuxtLink
v-for="o in list.data.value.items" :key="o.id" :to="{ path: `/upstreams/${o.id}`, query: { tab: sideTab } }" :aria-current="o.id === id ? 'page' : undefined"
        class="flex min-h-11 flex-col justify-center gap-1 rounded-md border border-transparent px-2.5 py-1.5 text-sm hover:bg-muted" :class="o.id === id && 'border-primary bg-accent'">
        <span class="flex items-center justify-between gap-2"><span class="truncate font-semibold">{{ o.name }}</span><StatusBadge :status="o.status" :setup="o.setup" /></span>
        <SparkBars v-if="o.hourly" :items="o.hourly" />
      </NuxtLink>
    </aside>
    <div class="flex min-w-0 flex-col gap-4">
    <PageHeader :title="u.name" :crumbs="[{ label: $t('upstreams.list.title'), to: '/upstreams' }]">
      <template #status><StatusBadge :status="u.status" :setup="u.setup" /></template>
      <Button variant="outline" :disabled="testing" @click="runTest">{{ $t('upstreams.detail.testConnection') }}</Button>
      <Button variant="outline" @click="toggleEnabled">{{ u.enabled ? $t('upstreams.detail.disable') : $t('upstreams.detail.enable') }}</Button>
      <Button as-child variant="outline"><NuxtLink :to="`/upstreams/${id}/edit`">{{ $t('upstreams.detail.edit') }}</NuxtLink></Button>
      <Button variant="destructive-outline" @click="del = true">{{ $t('upstreams.detail.delete') }}</Button>
    </PageHeader>
    <Alert v-if="u.statusReason || u.setup === 'awaiting_approval'" role="status" class="border-warn-border bg-warn-bg text-warn-fg">
      <template v-if="u.setup === 'awaiting_approval'">{{ $t('upstreams.detail.awaitingApproval') }} <NuxtLink :to="`/upstreams/${id}/approve`" class="font-semibold underline">{{ $t('upstreams.detail.reviewDraft') }}</NuxtLink></template>
      <template v-else>{{ u.statusReason }}<span v-if="u.nextRetryAt"> {{ $t('upstreams.detail.nextRetry', { time: formatCountdown(u.nextRetryAt) }) }}</span></template>
    </Alert>
    <TestResult v-if="test" :result="test" />

    <Tabs v-model="tab">
      <TabsList class="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
        <TabsTrigger v-for="[v, l] in TABS" :key="v" :value="v" :class="TAB_CLASS">{{ l }}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" class="mt-4 flex flex-col gap-4">
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-3">
          <KpiCard :label="$t('upstreams.detail.kpiTools')" :value="`${u.toolsEnabled} / ${u.toolsTotal}`" />
          <KpiCard v-if="u.p95Ms != null" label="p95" :value="formatMs(u.p95Ms)" />
          <KpiCard :label="$t('upstreams.detail.kpiRateHits')" :value="String(u.rateLimitHits5m)" />
        </div>
        <section v-if="st.data.value" :aria-label="$t('upstreams.stats.kpis')" class="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3">
          <KpiCard :label="$t('upstreams.stats.kpiP50')" :value="formatNumber(st.data.value.p50Ms)" unit="ms" :note="$t('upstreams.stats.note7d', { ms: formatMs(st.data.value.baseline.p50Ms) })" />
          <KpiCard :label="$t('upstreams.stats.kpiP95')" :value="formatNumber(st.data.value.p95Ms)" unit="ms" :note="$t('upstreams.stats.note7d', { ms: formatMs(st.data.value.baseline.p95Ms) })" :class="p95Slow && 'border-warn-border'" />
          <KpiCard :label="$t('upstreams.stats.kpiOverhead')" :value="formatNumber(st.data.value.overheadP95Ms)" unit="ms" :note="$t('upstreams.stats.noteTarget')" />
          <KpiCard :label="$t('upstreams.stats.kpiErrorRate')" :value="formatPercent(st.data.value.errorRate)" :note="$t('upstreams.stats.noteErrors', { errors: formatNumber(st.data.value.errorCount), calls: formatNumber(st.data.value.calls) })" />
          <KpiCard :label="$t('upstreams.stats.kpiCallsPerMin')" :value="formatNumber(st.data.value.callsPerMin, 1)" unit="/ min" :note="$t('upstreams.stats.noteLimit', { n: u.ratePerMin })" />
        </section>
        <Alert v-if="p95Slow" role="status" class="border-warn-border bg-warn-bg text-warn-fg">{{ $t('upstreams.stats.slowNote', { factor: formatNumber(st.data.value!.p95Ms / st.data.value!.baseline.p95Ms, 1) }) }}</Alert>
        <section class="rounded-lg border bg-card p-5" aria-labelledby="h-det">
          <h2 id="h-det" class="mb-3 text-[15px] font-semibold">{{ $t('upstreams.detail.details') }}</h2>
          <dl class="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt class="text-muted-foreground">{{ $t('upstreams.detail.type') }}</dt><dd>{{ typeLabel(u.type) }}</dd>
            <dt class="text-muted-foreground">{{ $t('upstreams.detail.slug') }}</dt><dd><code>{{ u.slug }}</code></dd>
            <dt class="text-muted-foreground">{{ u.type === 'http' ? 'URL' : $t('upstreams.detail.command') }}</dt><dd class="mono text-xs">{{ u.url ?? u.command }}</dd>
            <dt class="text-muted-foreground">{{ $t('upstreams.detail.auth') }}</dt><dd>{{ authTypeLabel(u.authType) }}<Badge v-if="u.hasSecret" variant="secondary" class="ml-2">{{ u.authType === 'oauth' ? $t('upstreams.oauth.badge') : $t('upstreams.detail.set') }}</Badge></dd>
            <dt class="text-muted-foreground">{{ $t('upstreams.detail.rateLimit') }}</dt><dd class="tnum">{{ $t('upstreams.detail.rateValue', { rate: u.ratePerMin, parallel: u.maxConcurrent }) }}</dd>
            <dt class="text-muted-foreground">{{ $t('upstreams.detail.timeouts') }}</dt><dd class="tnum">{{ u.timeouts.connectMs / 1000 }} s · {{ u.timeouts.listMs / 1000 }} s · {{ u.timeouts.callMs / 1000 }} s</dd>
            <dt class="text-muted-foreground">{{ $t('upstreams.detail.lastOk') }}</dt><dd><RelativeTime :value="u.lastOkAt" :empty="$t('upstreams.detail.never')" /></dd>
          </dl>
        </section>
        <section v-if="history.data.value" class="rounded-lg border bg-card p-5"><StatusHistory :history="history.data.value" /></section>
        <div v-if="st.data.value" class="grid gap-4 lg:grid-cols-2">
          <section class="flex flex-col gap-2 rounded-lg border bg-card p-5" aria-labelledby="h-pct">
            <h2 id="h-pct" class="text-[15px] font-semibold">{{ $t('upstreams.stats.percentileTitle') }}</h2>
            <PercentileChart :series="st.data.value.series" :start="$t('upstreams.stats.ago24h')" :end="$t('stats.now')" :label="$t('upstreams.stats.percentileAria', { p50: formatMs(st.data.value.p50Ms), p95: formatMs(st.data.value.p95Ms) })" />
            <p class="flex gap-3.5 text-xs text-secondary-foreground"><span>─ p50</span><span>╌ p95</span><span>··· p99</span></p>
          </section>
          <section class="flex flex-col gap-2 rounded-lg border bg-card p-5" aria-labelledby="h-err">
            <h2 id="h-err" class="text-[15px] font-semibold">{{ $t('upstreams.stats.errorsTitle') }}</h2>
            <p v-if="!st.data.value.errors.length" class="text-[13px] text-muted-foreground">{{ $t('upstreams.stats.noErrors') }}</p>
            <table v-else class="w-full text-[13px]">
              <thead class="text-xs text-muted-foreground"><tr><th scope="col" class="py-1 text-left font-normal">{{ $t('upstreams.stats.colKind') }}</th><th scope="col" class="px-2 text-left font-normal">{{ $t('upstreams.stats.colShare') }}</th><th scope="col" class="px-2 text-right font-normal">{{ $t('upstreams.stats.colCount') }}</th><th scope="col" class="text-right font-normal">{{ $t('upstreams.stats.colAvg') }}</th></tr></thead>
              <tbody>
                <tr v-for="e in st.data.value.errors" :key="e.outcome" class="tnum">
                  <td class="py-1.5 text-secondary-foreground">{{ outcomeLabel(e.outcome) }}</td>
                  <td class="px-2"><span class="block h-2 rounded-sm bg-muted" aria-hidden="true"><span class="block h-2 rounded-sm bg-secondary-foreground" :style="{ width: `${(e.count / maxErr) * 100}%` }" /></span></td>
                  <td class="px-2 text-right">{{ formatNumber(e.count) }}</td><td class="text-right text-secondary-foreground">{{ fmtSeconds(e.avgMs) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="pt-1 text-xs text-muted-foreground">{{ $t('upstreams.stats.errorsNote') }}</p>
          </section>
        </div>
      </TabsContent>
      <TabsContent value="tools" class="mt-4">
        <section class="overflow-hidden rounded-lg border bg-card">
          <LoadingRows v-if="!tools.data.value && !tools.error.value" />
          <ErrorState v-else-if="tools.error.value" :error="tools.error.value" @retry="tools.refresh()" />
          <p v-else-if="!tools.data.value?.items.length" class="p-5 text-[13px] text-muted-foreground">{{ $t('upstreams.detail.noTools') }}</p>
          <div v-else class="overflow-x-auto"><div class="min-w-[640px]"><ToolTable :tools="tools.data.value.items" :save="saveTool" :stats="st.data.value ? toolStats : undefined" @changed="up.refresh()" /></div></div>
        </section>
      </TabsContent>
      <TabsContent value="auth" class="mt-4">
        <section class="flex max-w-[600px] flex-col gap-3 rounded-lg border bg-card p-5" aria-labelledby="h-auth">
          <h2 id="h-auth" class="text-[15px] font-semibold">{{ $t('upstreams.detail.authHeading', { type: authTypeLabel(u.authType) }) }}</h2>
          <template v-if="u.authType === 'none'"><p class="text-[13px] text-muted-foreground">{{ $t('upstreams.detail.authNone') }}</p></template>
          <template v-else-if="u.authType === 'oauth'">
            <p class="text-sm">{{ $t('upstreams.detail.state') }} <Badge variant="secondary" data-testid="oauth-state">{{ u.hasSecret ? $t('upstreams.oauth.badge') : $t('upstreams.oauth.notConnected') }}</Badge></p>
            <p class="text-[13px] text-muted-foreground">{{ $t('upstreams.oauth.explain') }}</p>
            <div class="flex flex-wrap gap-2">
              <LoadingButton :busy="connecting" type="button" @click="oauthConnect">{{ u.hasSecret ? $t('upstreams.oauth.reconnect') : $t('upstreams.oauth.connect') }}</LoadingButton>
              <Button v-if="u.hasSecret" type="button" variant="outline" @click="oauthDisconnect">{{ $t('upstreams.oauth.disconnect') }}</Button>
            </div>
          </template>
          <template v-else>
            <p class="text-sm">{{ $t('upstreams.detail.state') }} <Badge variant="secondary">{{ u.hasSecret ? $t('upstreams.detail.set') : $t('upstreams.detail.stateNotSet') }}</Badge></p>
            <p v-if="replaced" role="status" class="text-[13px] text-ok-fg">{{ $t('upstreams.detail.secretReplaced') }}</p>
            <form class="flex flex-col gap-3" novalidate @submit.prevent="saveSecret">
              <FormRow id="a-secret" :label="$t('upstreams.detail.newSecret')" :description="$t('upstreams.detail.newSecretDesc')" :error="sec.form.errors.value.value">
                <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="secret" :invalid="invalid" :describedby="describedby" /></template>
              </FormRow>
              <div><LoadingButton :busy="sec.busy.value">{{ $t('upstreams.detail.replace') }}</LoadingButton></div>
            </form>
          </template>
        </section>
      </TabsContent>
    </Tabs>
    <ConfirmDialog :open="del" :title="$t('upstreams.detail.deleteTitle')" :confirm-label="$t('upstreams.detail.deleteConfirm')" @update:open="del = $event" @confirm="doDelete">
      {{ $t('upstreams.detail.deleteText', { name: u.name, n: u.toolsTotal }, u.toolsTotal) }}
    </ConfirmDialog>
    </div>
    </div>
  </template>
</template>
