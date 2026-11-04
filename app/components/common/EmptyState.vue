<script setup lang="ts">
defineProps<{ title: string, text?: string }>()
</script>

<template>
  <div class="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="empty-state">
    <h3 class="text-[15px] font-semibold">{{ title }}</h3>
    <p v-if="text" class="max-w-md text-[13px] text-muted-foreground">{{ text }}</p>
    <div class="mt-2 flex flex-wrap justify-center gap-2"><slot /></div>
  </div>
</template>
