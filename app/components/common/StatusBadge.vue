<script setup lang="ts">
import { computed } from 'vue'
import { healthLabel, setupLabel } from '~/lib/labels'

const props = defineProps<{ status: string, setup?: string | null }>()
// Wartezustand (setup) hat Vorrang vor dem Health-Wert, solange der Upstream nicht bereit ist.
const waiting = computed(() => props.setup && props.setup !== 'ready')
const key = computed(() => (waiting.value ? 'unknown' : ['healthy', 'degraded', 'open', 'auth_expired', 'disabled', 'unknown'].includes(props.status) ? props.status : 'unknown'))
const label = computed(() => (waiting.value ? setupLabel(props.setup!) : healthLabel(props.status)))
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-xs font-medium whitespace-nowrap"
    :style="{ background: `var(--st-${key}-bg)`, color: `var(--st-${key}-fg)` }"
    :title="status"
    data-testid="status-badge"
  >
    <span class="size-1.5 rounded-full" :style="{ background: `var(--st-${key}-fg)` }" aria-hidden="true" />
    {{ label }}
  </span>
</template>
