<script setup lang="ts">
defineProps<{ active: boolean }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-sm font-medium" :class="active ? 'text-st-healthy-fg' : 'text-secondary-foreground'">
    <span class="size-2 rounded-full" :class="active ? 'bg-st-healthy-bar' : 'bg-st-disabled-dot'" aria-hidden="true" />
    {{ active ? 'Aktiv' : 'Inaktiv' }}
  </span>
</template>
