<script setup lang="ts">
import type { UpstreamToolItem } from '#shared/api-types'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Checkbox } from '~/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatMs, formatPercent } from '~/lib/format'
import { toolKind } from '~/lib/labels'

// Colour of the kind chip (text label always present): reading green, writing amber, deleting red.
const kindTone = (a?: { readOnlyHint?: boolean, destructiveHint?: boolean }) => (a?.destructiveHint ? 'bg-err-bg text-err-fg' : a?.readOnlyHint ? 'bg-ok-bg text-ok-fg' : a?.readOnlyHint === false ? 'bg-warn-bg text-warn-fg' : 'bg-muted text-secondary-foreground')

const { t: tr } = useI18n()
// Optimistic switch with rollback on error; descriptions are untrusted and text only (truncated).
const props = defineProps<{ tools: UpstreamToolItem[], save: (name: string, enabled: boolean) => Promise<unknown>, stats?: Record<string, { errorRate: number, p95Ms: number }> }>()
const emit = defineEmits<{ changed: [] }>()
const local = ref<Record<string, boolean>>({})
const on = (t: UpstreamToolItem) => local.value[t.name] ?? t.enabled
async function toggle(t: UpstreamToolItem, v: boolean) {
  local.value = { ...local.value, [t.name]: v }
  try { await props.save(t.name, v); emit('changed') } catch {
    local.value = { ...local.value, [t.name]: !v }
    toast.error(tr('upstreams.tools.saveFailed', { name: t.name }))
  }
}
const trim = (s: string | null) => ((s ?? '').length > 160 ? `${(s ?? '').slice(0, 160)}…` : (s ?? ''))
</script>

<template>
  <Table>
    <caption class="sr-only">{{ $t('upstreams.tools.caption') }}</caption>
    <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('upstreams.tools.name') }}</TableHead><TableHead scope="col">{{ $t('upstreams.tools.description') }}</TableHead><TableHead scope="col">{{ $t('upstreams.tools.kind') }}</TableHead><TableHead v-if="stats" scope="col">{{ $t('upstreams.stats.colErrors') }}</TableHead><TableHead v-if="stats" scope="col">p95</TableHead><TableHead scope="col" class="text-right">{{ $t('upstreams.tools.active') }}</TableHead></TableRow></TableHeader>
    <TableBody>
      <TableRow v-for="t in tools" :key="t.name" :class="t.gone && 'opacity-60'">
        <TableCell><code class="text-xs">{{ t.name }}</code><span v-if="t.gone" class="ml-2 text-xs text-muted-foreground">{{ $t('upstreams.tools.gone') }}</span></TableCell>
        <TableCell class="max-w-md whitespace-normal text-[13px] text-secondary-foreground">{{ trim(t.description) }}</TableCell>
        <TableCell><span class="inline-block rounded-sm px-2 py-0.5 text-xs font-medium" :class="kindTone(t.annotations)">{{ toolKind(t.annotations) }}</span></TableCell>
        <template v-if="stats">
          <TableCell class="tnum" :class="(stats[t.name]?.errorRate ?? 0) >= 0.2 ? 'font-medium text-err-fg' : (stats[t.name]?.errorRate ?? 0) >= 0.05 ? 'font-medium text-warn-fg' : ''">{{ stats[t.name] ? formatPercent(stats[t.name]!.errorRate) : '–' }}</TableCell>
          <TableCell class="tnum text-secondary-foreground">{{ stats[t.name] ? formatMs(stats[t.name]!.p95Ms) : '–' }}</TableCell>
        </template>
        <TableCell class="text-right"><label class="ml-auto flex size-11 items-center justify-center"><Checkbox :model-value="on(t)" :disabled="t.gone" class="size-[18px]" :aria-label="$t('upstreams.tools.activeAria', { name: t.name })" @update:model-value="(v) => toggle(t, v === true)" /></label></TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
