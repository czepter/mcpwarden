<script setup lang="ts">
import type { AuditCategory, AuditItem } from '#shared/api-types'
import { auditApi } from '~/api'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { formatDateTime } from '~/lib/format'
import { auditResultLabel } from '~/lib/labels'

const { t } = useI18n()
useHead({ title: () => `${t('audit.crumb')} · mcpwarden` })
const cat = ref<AuditCategory | 'all'>('all')
const rows = ref<AuditItem[]>([])
const cursor = ref<string | null>(null)
const loading = ref(true)
const more = ref(false)
const error = ref<unknown>(null)
async function load(append = false) {
  if (append) more.value = true; else loading.value = true
  error.value = null
  try {
    const r = await auditApi.list({ category: cat.value === 'all' ? undefined : cat.value, cursor: append ? cursor.value ?? undefined : undefined, limit: 50 })
    rows.value = append ? [...rows.value, ...r.items] : r.items; cursor.value = r.nextCursor
  } catch (e) { error.value = e } finally { loading.value = false; more.value = false }
}
onMounted(() => load())
watch(cat, () => load())
const RESULT_TONE: Record<string, string> = { success: 'text-st-healthy-fg', pending: 'text-st-degraded-fg', status_change: 'text-st-degraded-fg', denied: 'text-st-open-fg' }
const CATS = computed<Array<[AuditCategory | 'all', string]>>(() => [['all', t('audit.catAll')], ['management', t('audit.catManagement')], ['auth', t('audit.catAuth')], ['status', t('audit.catStatus')], ['denied', t('audit.catDenied')]])
</script>

<template>
  <PageHeader :title="$t('audit.title')" :crumb="$t('audit.crumb')" />
  <div class="border-b">
    <ToggleGroup v-model="cat" type="single" variant="default" :aria-label="$t('audit.category')" class="w-fit gap-1" @update:model-value="(v) => { if (!v) cat = 'all' }">
      <ToggleGroupItem v-for="[v, l] in CATS" :key="v" :value="v" class="-mb-px h-11 rounded-none border-b-2 border-transparent bg-transparent px-4 text-secondary-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:text-foreground">{{ l }}</ToggleGroupItem>
    </ToggleGroup>
  </div>
  <DataSection min-width="720px">
    <LoadingRows v-if="loading" />
    <ErrorState v-else-if="error" :error="error" @retry="load()" />
    <EmptyState v-else-if="!rows.length" :title="$t('audit.emptyTitle')" :text="$t('audit.emptyText')" />
    <table v-else class="w-full text-sm">
      <caption class="sr-only">{{ $t('audit.title') }}</caption>
      <thead class="bg-table-head text-xs text-muted-foreground"><tr class="border-y"><th scope="col" class="px-5 py-2.5 text-left font-medium">{{ $t('audit.colTime') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('audit.colClient') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('audit.colAction') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('audit.colTarget') }}</th><th scope="col" class="px-5 text-left font-medium">{{ $t('audit.colResult') }}</th></tr></thead>
      <tbody>
        <tr v-for="a in rows" :key="a.id" class="h-[52px] border-b border-muted">
          <td class="px-5 py-1.5 text-[13px] whitespace-nowrap text-secondary-foreground">{{ formatDateTime(a.ts) }}</td>
          <td class="px-3">{{ a.clientName ?? (a.scope === 'instance' ? $t('audit.admin') : $t('audit.webUi')) }}</td>
          <td class="px-3"><code class="mono text-xs">{{ a.action }}</code></td>
          <td class="px-3 text-[13px] text-secondary-foreground">{{ a.targetLabel ?? '–' }}</td>
          <td class="px-5"><span class="inline-flex items-center gap-2 font-medium" :class="RESULT_TONE[a.result] ?? 'text-secondary-foreground'"><span class="size-2 rounded-full bg-current" aria-hidden="true" />{{ auditResultLabel(a.result) }}</span></td>
        </tr>
      </tbody>
    </table>
    <template v-if="cursor" #footer><Button variant="outline" :disabled="more" @click="load(true)">{{ $t('audit.loadMore') }}</Button></template>
  </DataSection>
</template>
