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

useHead({ title: 'Audit · mcpwarden' })
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
const CATS: Array<[AuditCategory | 'all', string]> = [['all', 'Alle'], ['admin', 'Verwaltung'], ['status', 'Status'], ['denied', 'Abgelehnt']]
</script>

<template>
  <PageHeader title="Audit" description="Verwaltungsaktionen und Statuswechsel." />
  <ToggleGroup v-model="cat" type="single" variant="outline" aria-label="Kategorie" class="w-fit" @update:model-value="(v) => { if (!v) cat = 'all' }">
    <ToggleGroupItem v-for="[v, l] in CATS" :key="v" :value="v" class="h-11 px-4">{{ l }}</ToggleGroupItem>
  </ToggleGroup>
  <DataSection min-width="720px">
    <LoadingRows v-if="loading" />
    <ErrorState v-else-if="error" :error="error" @retry="load()" />
    <EmptyState v-else-if="!rows.length" title="Keine Einträge" text="Hier erscheinen Verwaltungsaktionen, sobald etwas passiert." />
    <table v-else class="w-full text-sm">
      <caption class="sr-only">Audit-Log</caption>
      <thead class="bg-table-head text-xs text-muted-foreground"><tr class="border-y"><th scope="col" class="px-5 py-2.5 text-left font-medium">Zeit</th><th scope="col" class="px-3 text-left font-medium">Client</th><th scope="col" class="px-3 text-left font-medium">Aktion</th><th scope="col" class="px-3 text-left font-medium">Ziel</th><th scope="col" class="px-5 text-left font-medium">Ergebnis</th></tr></thead>
      <tbody>
        <tr v-for="a in rows" :key="a.id" class="border-b border-muted">
          <td class="px-5 py-2 whitespace-nowrap">{{ formatDateTime(a.ts) }}</td>
          <td class="px-3">{{ a.clientName ?? (a.scope === 'instance' ? 'Admin' : 'Web-UI') }}</td>
          <td class="px-3"><code class="text-xs">{{ a.action }}</code></td>
          <td class="px-3">{{ a.targetLabel ?? '–' }}</td>
          <td class="px-5">{{ auditResultLabel(a.result) }}</td>
        </tr>
      </tbody>
    </table>
    <template v-if="cursor" #footer><Button variant="outline" :disabled="more" @click="load(true)">Mehr laden</Button></template>
  </DataSection>
</template>
