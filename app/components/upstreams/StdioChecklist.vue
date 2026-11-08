<script setup lang="ts">
import type { StdioReason } from '#shared/api-types'
import { computed } from 'vue'
import { checklistStateText, stdioChecklist } from '~/lib/stdio-checklist'

const props = defineProps<{ caps: { stdio: { allowed: boolean, reason?: StdioReason } } }>()
const rows = computed(() => stdioChecklist(props.caps))
const TONE = { ok: 'text-ok-fg', blocked: 'text-err-fg', open: 'text-warn-fg' } as const
</script>

<template>
  <section aria-labelledby="h-prereq" class="flex flex-col gap-2 border-t pt-4" data-testid="stdio-checklist">
    <h2 id="h-prereq" class="sr-only">{{ $t('upstreams.checklist.heading') }}</h2>
    <ul class="flex flex-col gap-2">
      <li v-for="r in rows" :key="r.key" :data-state="r.state" class="flex items-start gap-2.5">
        <!-- Mark and text per row: the state never depends on colour alone. -->
        <span class="mt-px shrink-0 font-bold" :class="TONE[r.state]" aria-hidden="true">{{ r.state === 'ok' ? '✓' : r.state === 'blocked' ? '✕' : '!' }}</span>
        <span>
          <span class="font-medium">{{ r.label }}<span class="sr-only">&nbsp;</span><span class="sr-only" data-testid="checklist-state">{{ checklistStateText[r.state] }}</span></span>
          <span v-if="r.detail" class="text-secondary-foreground" :data-testid="r.state === 'blocked' ? 'stdio-block-reason' : undefined"> {{ r.detail }}</span>
        </span>
      </li>
    </ul>
  </section>
</template>
