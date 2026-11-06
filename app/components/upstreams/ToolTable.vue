<script setup lang="ts">
import type { UpstreamToolItem } from '#shared/api-types'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Switch } from '~/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { toolKind } from '~/lib/labels'

const { t: tr } = useI18n()
// Optimistic switch with rollback on error; descriptions are untrusted and text only (truncated).
const props = defineProps<{ tools: UpstreamToolItem[], save: (name: string, enabled: boolean) => Promise<unknown> }>()
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
    <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('upstreams.tools.name') }}</TableHead><TableHead scope="col">{{ $t('upstreams.tools.description') }}</TableHead><TableHead scope="col">{{ $t('upstreams.tools.kind') }}</TableHead><TableHead scope="col">{{ $t('upstreams.tools.active') }}</TableHead></TableRow></TableHeader>
    <TableBody>
      <TableRow v-for="t in tools" :key="t.name" :class="t.gone && 'opacity-60'">
        <TableCell><code class="text-xs">{{ t.name }}</code><span v-if="t.gone" class="ml-2 text-xs text-muted-foreground">{{ $t('upstreams.tools.gone') }}</span></TableCell>
        <TableCell class="max-w-md text-[13px] text-secondary-foreground">{{ trim(t.description) }}</TableCell>
        <TableCell><span class="rounded-sm bg-muted px-1.5 py-0.5 text-xs">{{ toolKind(t.annotations) }}</span></TableCell>
        <TableCell><Switch :model-value="on(t)" :disabled="t.gone" :aria-label="$t('upstreams.tools.activeAria', { name: t.name })" @update:model-value="(v) => toggle(t, v)" /></TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
