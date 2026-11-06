<script setup lang="ts">
// Mock banner only in the mock build: __API_MOCK__ is a compile-time constant, in the production build the branch is dropped together with the chunk.
import LocaleSwitcher from '~/components/shell/LocaleSwitcher.vue'
const MockBanner = __API_MOCK__ ? defineAsyncComponent(() => import('~/components/shell/MockBanner.vue')) : undefined
</script>

<template>
  <div class="min-h-screen bg-background">
    <component :is="MockBanner" v-if="MockBanner" />
    <main class="mx-auto flex min-h-[80vh] flex-col items-center justify-center gap-4 px-4 py-10">
      <div class="flex items-center gap-2.5">
        <div class="flex size-9 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground" aria-hidden="true">m</div>
        <span class="text-[15px] font-bold tracking-tight">mcpwarden</span>
      </div>
      <slot />
      <LocaleSwitcher />
    </main>
  </div>
</template>
