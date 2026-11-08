<script setup lang="ts">
// Like `auth`, but without the logo above the card: these pages show the brand inside the card (mockup). A separate layout instead of a route-meta check keeps page transitions intact.
// Mock banner only in the mock build: __API_MOCK__ is a compile-time constant, in the production build the branch is dropped together with the chunk.
import LocaleSwitcher from '~/components/shell/LocaleSwitcher.vue'
const MockBanner = __API_MOCK__ ? defineAsyncComponent(() => import('~/components/shell/MockBanner.vue')) : undefined
</script>

<template>
  <div class="min-h-screen bg-background">
    <component :is="MockBanner" v-if="MockBanner" />
    <main class="mx-auto flex min-h-[80vh] flex-col items-center justify-center gap-4 px-4 py-10">
      <slot />
      <LocaleSwitcher />
    </main>
  </div>
</template>
