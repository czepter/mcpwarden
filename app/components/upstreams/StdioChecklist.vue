<script setup lang="ts">
import type { StdioReason } from '#shared/api-types'
import { computed } from 'vue'
import { CircleAlert, CircleCheck, CircleDashed } from '@lucide/vue'
import { checklistStateText, stdioChecklist } from '~/lib/stdio-checklist'

const props = defineProps<{ caps: { stdio: { allowed: boolean, reason?: StdioReason } } }>()
const rows = computed(() => stdioChecklist(props.caps))
const TONE = { ok: 'text-ok-fg', blocked: 'text-err-fg', open: 'text-warn-fg' } as const
</script>

<template>
  <section aria-labelledby="h-prereq" class="flex flex-col gap-2" data-testid="stdio-checklist">
    <h2 id="h-prereq" class="text-[15px] font-semibold">{{ $t('upstreams.checklist.heading') }}</h2>
    <ul class="flex flex-col divide-y rounded-sm border bg-card">
      <li v-for="r in rows" :key="r.key" :data-state="r.state" class="flex items-start gap-3 px-3 py-2.5">
        <!-- Icon and text per row: the state never depends on colour alone. -->
        <component :is="r.state === 'ok' ? CircleCheck : r.state === 'blocked' ? CircleAlert : CircleDashed" class="mt-0.5 size-4 shrink-0" :class="TONE[r.state]" aria-hidden="true" />
        <div class="flex min-w-0 flex-col">
          <span class="text-sm font-medium">{{ r.label }}<span class="ml-2 text-xs font-semibold" :class="TONE[r.state]" data-testid="checklist-state">{{ checklistStateText[r.state] }}</span></span>
          <span v-if="r.detail" class="text-[13px] text-secondary-foreground" :data-testid="r.state === 'blocked' ? 'stdio-block-reason' : undefined">{{ r.detail }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>
