<script setup lang="ts">
defineProps<{ title?: string, description?: string, minWidth?: string }>()
</script>

<template>
  <section class="bg-card border rounded-lg overflow-hidden">
    <header v-if="title || $slots.actions" class="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
      <div>
        <h2 v-if="title" class="text-[15px] font-semibold">{{ title }}</h2>
        <p v-if="description" class="text-[13px] text-muted-foreground">{{ description }}</p>
      </div>
      <div class="flex gap-2"><slot name="actions" /></div>
    </header>
    <div class="overflow-x-auto"><div :style="{ minWidth }"><slot /></div></div>
    <footer v-if="$slots.footer" class="bg-muted px-5 py-2.5 text-[13px] text-secondary-foreground"><slot name="footer" /></footer>
  </section>
</template>
