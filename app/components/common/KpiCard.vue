<script setup lang="ts">
defineProps<{ label: string, value: string, unit?: string, note?: string, dot?: string, share?: number }>()
</script>

<template>
  <div class="bg-card border rounded-lg px-4 py-3.5 flex flex-col gap-2">
    <div class="flex items-center gap-2 text-[13px] font-medium text-secondary-foreground">
      <span v-if="dot" class="size-2 rounded-full" :style="{ background: dot }" aria-hidden="true" />
      {{ label }}
    </div>
    <div class="flex items-baseline gap-1.5">
      <span class="text-2xl font-bold tnum">{{ value }}</span>
      <span v-if="unit" class="text-[13px] text-muted-foreground">{{ unit }}</span>
    </div>
    <div v-if="share !== undefined" class="h-1.5 rounded-sm bg-muted" aria-hidden="true">
      <div class="h-1.5 rounded-sm" :style="{ width: `${share * 100}%`, background: dot }" />
    </div>
    <div v-if="note" class="text-xs text-muted-foreground">{{ note }}</div>
  </div>
</template>
