<script setup lang="ts">
defineProps<{ active: boolean }>()
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-sm font-medium" :class="active ? 'text-[#166534]' : 'text-secondary-foreground'">
    <span class="size-2 rounded-full" :class="active ? 'bg-[#16a34a]' : 'bg-[#71717a]'" aria-hidden="true" />
    {{ active ? 'Aktiv' : 'Inaktiv' }}
  </span>
</template>
