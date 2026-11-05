<script setup lang="ts">
import { toast } from 'vue-sonner'
import { dashboardApi, meApi } from '~/api'
import type { DashboardClient } from '#shared/api-types'
import AutoRefresh from '~/components/common/AutoRefresh.vue'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import CopyButton from '~/components/common/CopyButton.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import StatusDot from '~/components/common/StatusDot.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { formatNumber, formatPercent } from '~/lib/format'

useHead({ title: 'Dashboard · mcpwarden' })
const { data, error, status, refresh } = useApi('dashboard', dashboardApi.get)
const caps = useApi('caps', meApi.capabilities)
const rate = ref(0)
usePolling(refresh, rate)
const cmd = computed(() => `claude mcp add --transport http mcpwarden ${caps.data.value?.mcpUrl ?? ''}`)
const revoke = ref<DashboardClient | null>(null)
async function doRevoke() {
  const c = revoke.value; if (!c) return
  try { if (c.kind === 'oauth') await meApi.revokeConnection(c.id); else await meApi.revokePat(c.id); toast.success('Zugriff widerrufen.'); await refresh() } catch { toast.error('Widerrufen fehlgeschlagen.') }
  revoke.value = null
}
const k = computed(() => data.value?.kpis)
</script>

<template>
  <PageHeader title="Dashboard"><AutoRefresh v-model="rate" /></PageHeader>
  <p v-if="useRoute().query.hinweis === 'admin'" role="status" class="rounded-sm border border-[#fcd34d] bg-[#fef3c7] px-3 py-2 text-[13px] text-[#78350f]">Dieser Bereich ist nur für Admins.</p>
  <LoadingRows v-if="status === 'pending' && !data" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
  <template v-else-if="data">
    <section v-if="k" aria-label="Kennzahlen" class="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
      <KpiCard label="Clients aktiv" :value="`${k.clientsActive} von ${k.clientsTotal}`" />
      <KpiCard label="Aufrufe pro Minute" :value="formatNumber(k.callsPerMin)" />
      <KpiCard label="Erfolgsquote" :value="formatPercent(k.successRate)" />
      <KpiCard label="Gateway-Overhead p95" :value="formatNumber(k.overheadP95Ms)" unit="ms" note="Ziel ≤ 50 ms" />
    </section>

    <div v-if="!data.clients.length" class="rounded-lg border bg-card">
      <EmptyState title="Noch kein Client verbunden" text="Verbinde Claude Code oder einen anderen MCP-Client mit dieser Adresse.">
        <code class="mono rounded-sm bg-muted px-2 py-1 text-xs" data-testid="mcp-url">{{ caps.data.value?.mcpUrl }}</code>
        <CopyButton v-if="caps.data.value" :value="caps.data.value.mcpUrl" label="URL kopieren" />
        <div class="basis-full" />
        <code class="mono rounded-sm bg-muted px-2 py-1 text-xs" data-testid="setup-cmd">{{ cmd }}</code>
        <CopyButton v-if="caps.data.value" :value="cmd" label="Befehl kopieren" />
        <p class="basis-full text-[13px] text-muted-foreground">Ohne OAuth: erzeuge unter <NuxtLink to="/settings/tokens" class="text-primary underline">Tokens</NuxtLink> ein Token und sende es als Bearer-Header.</p>
      </EmptyState>
    </div>
    <DataSection v-else title="Verbundene Clients" min-width="760px">
      <template #actions><NuxtLink to="/settings/connections" class="text-[13px] text-primary underline">Alle Clients und Tokens</NuxtLink></template>
      <table class="w-full text-sm">
        <caption class="sr-only">Verbundene Clients</caption>
        <thead class="bg-table-head text-xs text-muted-foreground"><tr class="border-y"><th scope="col" class="px-5 py-2.5 text-left font-medium">Client</th><th scope="col" class="px-3 text-left font-medium">Anmeldung</th><th scope="col" class="px-3 text-left font-medium">Status</th><th scope="col" class="px-3 text-left font-medium">Zuletzt aktiv</th><th scope="col" class="px-3 text-right font-medium">Aufrufe/min</th><th scope="col" class="px-3 text-right font-medium">Tools im Kontext</th><th scope="col" class="px-5"><span class="sr-only">Aktionen</span></th></tr></thead>
        <tbody>
          <tr v-for="c in data.clients" :key="`${c.kind}-${c.id}`" class="border-b border-muted">
            <td class="px-5 py-2 font-medium">{{ c.name }}<Badge v-if="c.allowlisted === false" variant="outline" class="ml-2">nicht in Allowlist</Badge></td>
            <td class="px-3">{{ c.kind === 'oauth' ? 'OAuth' : 'Token' }}</td>
            <td class="px-3"><StatusDot :active="c.active" /></td>
            <td class="px-3"><RelativeTime :value="c.lastActiveAt" empty="nie" /></td>
            <td class="tnum px-3 text-right">{{ formatNumber(c.callsPerMin) }}</td>
            <td class="tnum px-3 text-right">{{ c.contextTokensEstimate == null ? '–' : `ca. ${formatNumber(c.contextTokensEstimate)} Tokens` }}</td>
            <td class="px-5 text-right"><Button variant="ghost" class="text-destructive" :aria-label="`${c.name} widerrufen`" @click="revoke = c">Widerrufen</Button></td>
          </tr>
        </tbody>
      </table>
    </DataSection>

    <DataSection title="Braucht Aufmerksamkeit">
      <p v-if="!data.attention.length" class="px-5 pb-4 text-[13px]" data-testid="nothing-to-do">Nichts zu tun. Alle Upstreams laufen.</p>
      <ul v-else class="divide-y">
        <li v-for="a in data.attention" :key="a.upstreamId" class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div class="flex items-center gap-3"><StatusBadge :status="a.status" /><NuxtLink :to="`/upstreams/${a.upstreamId}`" class="font-semibold hover:underline">{{ a.name }}</NuxtLink><span class="text-[13px] text-secondary-foreground">{{ a.statusReason }}</span></div>
          <Button v-if="a.status === 'auth_expired'" as-child variant="outline"><NuxtLink :to="`/upstreams/${a.upstreamId}?tab=auth`">Neu verbinden</NuxtLink></Button>
        </li>
      </ul>
    </DataSection>
    <ConfirmDialog :open="!!revoke" title="Zugriff widerrufen?" confirm-label="Widerrufen" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
      {{ revoke?.kind === 'oauth' ? 'Die Verbindung' : 'Das Token' }} „{{ revoke?.name }}“ wird beendet. Das wirkt beim nächsten Aufruf.
    </ConfirmDialog>
  </template>
</template>
