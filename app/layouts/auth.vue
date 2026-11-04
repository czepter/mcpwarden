<script setup lang="ts">
import MockBanner from '~/components/shell/MockBanner.vue'
</script>

<template>
  <div class="min-h-screen bg-background">
    <MockBanner />
    <main class="mx-auto flex min-h-[80vh] flex-col items-center justify-center gap-4 px-4 py-10">
      <div class="flex items-center gap-2.5">
        <div class="flex size-9 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground" aria-hidden="true">m</div>
        <span class="text-[15px] font-bold tracking-tight">mcpwarden</span>
      </div>
      <slot />
    </main>
  </div>
</template>
