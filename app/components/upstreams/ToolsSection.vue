<script setup lang="ts">
import type { UpstreamToolItem } from '#shared/api-types'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import ToolTable from '~/components/upstreams/ToolTable.vue'

// Tools card (draft): heading with the active count, note on the right, table below. Used in the overview and in the Tools tab.
defineProps<{ tools: UpstreamToolItem[] | null | undefined, error?: unknown, enabled: number, total: number, save: (name: string, enabled: boolean) => Promise<unknown>, stats?: Record<string, { errorRate: number, p95Ms: number }> }>()
const emit = defineEmits<{ changed: [], retry: [] }>()
</script>

<template>
  <section :aria-label="$t('upstreams.tools.caption')" class="overflow-hidden rounded-lg border bg-card">
    <div class="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
      <h3 class="text-[15px] font-semibold">{{ $t('upstreams.detail.toolsHeading', { on: enabled, total }) }}</h3>
      <span class="text-[13px] text-muted-foreground">{{ $t('upstreams.detail.toolsNote') }}</span>
    </div>
    <LoadingRows v-if="!tools && !error" />
    <ErrorState v-else-if="error" :error="error" @retry="emit('retry')" />
    <p v-else-if="!tools?.length" class="px-5 pb-5 text-[13px] text-muted-foreground">{{ $t('upstreams.detail.noTools') }}</p>
    <div v-else class="overflow-x-auto"><div class="min-w-[860px]"><ToolTable :tools="tools" :save="save" :stats="stats" @changed="emit('changed')" /></div></div>
  </section>
</template>
