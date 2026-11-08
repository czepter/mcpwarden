<script setup lang="ts">
import { toast } from 'vue-sonner'
import { adminApi } from '~/api'
import { ApiError } from '~/api/http'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import AdminTabs from '~/components/shell/AdminTabs.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import TimeWindow from '~/components/common/TimeWindow.vue'
import { formatNumber, formatPercent } from '~/lib/format'
import { outcomeLabel } from '~/lib/labels'
import type { StatsWindow } from '#shared/api-types'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Checkbox } from '~/components/ui/checkbox'

definePageMeta({ middleware: 'admin' })
const { t } = useI18n()
useHead({ title: () => t('admin.settings.pageTitle') })
const { data, error, status, refresh } = useApi('admin-settings', adminApi.settings)
// Instance figures (spec P0-15): aggregated counters, never contents of other users.
const win = ref<StatsWindow>('24h')
const stats = useAsyncData('admin-stats', () => adminApi.stats(win.value), { server: false, lazy: true, watch: [win] })
const warnings = ref<string[]>([])
const entry = ref('')
const entryError = ref('')
async function put(b: Parameters<typeof adminApi.putSettings>[0]) {
  try {
    const r = await adminApi.putSettings(b)
    warnings.value = r.warnings.map(w => w.entry)
    await refresh(); toast.success(t('admin.settings.saved'))
    return true
  } catch (e) { entryError.value = e instanceof ApiError ? e.message : t('admin.settings.saveFailed'); return false }
}
async function addEntry() {
  entryError.value = ''
  const v = entry.value.trim().toLowerCase()
  if (!v) { entryError.value = t('admin.settings.entryRequired'); return }
  if (await put({ 'ssrf.allow': [...(data.value?.['ssrf.allow'] ?? []), v] })) entry.value = ''
}
const removeEntry = (e: string) => put({ 'ssrf.allow': (data.value?.['ssrf.allow'] ?? []).filter(x => x !== e) })
</script>

<template>
  <PageHeader :title="$t('admin.title')" :crumbs="[{ label: $t('admin.title') }]" :crumb="$t('common.adminTabs.instance')" :description="$t('common.adminTabs.hint')" data-testid="admin-hint" />
  <AdminTabs />
  <LoadingRows v-if="status === 'pending' && !data" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
  <div v-else-if="data" class="flex flex-col gap-8">
    <section class="flex max-w-[720px] flex-col gap-3" aria-labelledby="h-instance">
      <h2 id="h-instance" class="text-base font-semibold">{{ $t('admin.settings.instanceTitle') }}</h2>
      <div class="flex flex-col rounded-lg border bg-card px-5 py-2">
        <label class="flex min-h-16 cursor-pointer items-center justify-between gap-4 border-b border-muted py-2">
          <span><span class="block font-medium">{{ $t('admin.settings.stdioTitle') }}</span><span class="block text-[13px] text-secondary-foreground">{{ $t('admin.settings.stdioDesc') }}</span></span>
          <Checkbox id="sw-stdio" class="size-5 shrink-0" :model-value="data['stdio.enabled']" @update:model-value="(v) => put({ 'stdio.enabled': v === true })" />
        </label>
        <div class="py-3" aria-labelledby="h-ssrf">
          <h3 id="h-ssrf" class="font-medium">{{ $t('admin.settings.ssrfTitle') }}</h3>
          <p class="mb-3 text-[13px] text-secondary-foreground">{{ $t('admin.settings.ssrfDesc') }}</p>
          <Alert v-for="w in warnings" :key="w" role="alert" class="mb-2 border-warn-border bg-warn-bg text-[13px] text-warn-fg">{{ $t('admin.settings.metadataWarning', { entry: w }) }}</Alert>
          <ul v-if="data['ssrf.allow'].length" class="mb-3 divide-y rounded-sm border">
            <li v-for="e in data['ssrf.allow']" :key="e" class="flex min-h-11 items-center justify-between px-3"><code class="mono text-xs">{{ e }}</code><Button variant="ghost" :aria-label="$t('admin.settings.removeExceptionAria', { entry: e })" @click="removeEntry(e)">{{ $t('admin.settings.remove') }}</Button></li>
          </ul>
          <p v-else class="mb-3 text-[13px]">{{ $t('admin.settings.noExceptions') }}</p>
          <form class="flex gap-2" novalidate @submit.prevent="addEntry">
            <div class="flex-1"><label for="ssrf-new" class="sr-only">{{ $t('admin.settings.newException') }}</label><Input id="ssrf-new" v-model="entry" class="mono" :placeholder="$t('admin.settings.placeholder')" :aria-invalid="!!entryError || undefined" aria-describedby="ssrf-err" /><p id="ssrf-err" role="alert" class="mt-1 text-sm text-destructive">{{ entryError }}</p></div>
            <Button type="submit" variant="outline">{{ $t('admin.settings.addEntry') }}</Button>
          </form>
        </div>
        <p class="border-t border-muted py-3 text-[13px] text-secondary-foreground">{{ $t('admin.settings.registrationNote') }}</p>
      </div>
    </section>

    <section class="flex flex-col gap-3" aria-labelledby="h-usage">
      <div class="flex flex-wrap items-center justify-between gap-2"><h2 id="h-usage" class="text-base font-semibold">{{ $t('admin.settings.usageTitle') }}</h2><TimeWindow v-model="win" /></div>
      <p class="text-[13px] text-muted-foreground">{{ $t('admin.settings.usageDesc') }}</p>
      <ErrorState v-if="stats.error.value" :error="stats.error.value" @retry="stats.refresh()" />
      <template v-else-if="stats.data.value">
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3">
          <KpiCard :label="$t('admin.settings.usageUsers')" :value="`${stats.data.value.activeUsers} / ${stats.data.value.users}`" :note="$t('admin.settings.usageUsersNote')" />
          <KpiCard :label="$t('admin.settings.usageUpstreams')" :value="formatNumber(stats.data.value.upstreams)" />
          <KpiCard :label="$t('admin.settings.usageCalls')" :value="formatNumber(stats.data.value.calls)" :note="$t('admin.settings.usagePerMin', { n: formatNumber(stats.data.value.callsPerMin, 1) })" />
          <KpiCard :label="$t('admin.settings.usageSuccess')" :value="formatPercent(stats.data.value.okRate)" />
          <KpiCard label="p95" :value="formatNumber(stats.data.value.p95Ms)" unit="ms" />
          <KpiCard :label="$t('admin.settings.usageOverhead')" :value="formatNumber(stats.data.value.overheadP95Ms)" unit="ms" :note="$t('dashboard.kpiOverheadNote')" />
        </div>
        <ul class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-secondary-foreground">
          <li v-for="o in stats.data.value.outcomes.filter(x => x.count)" :key="o.outcome">{{ outcomeLabel(o.outcome) }}: <span class="tnum font-medium">{{ formatNumber(o.count) }}</span></li>
        </ul>
        <p v-if="stats.data.value.statsDropped" role="status" class="text-[13px] text-warn-fg">{{ $t('admin.settings.usageDropped', { n: formatNumber(stats.data.value.statsDropped) }) }}</p>
      </template>
    </section>
  </div>
</template>
