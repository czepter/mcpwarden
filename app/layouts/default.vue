<script setup lang="ts">
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import AppSidebar from '~/components/shell/AppSidebar.vue'

// Mock banner only in the mock build: __API_MOCK__ is a compile-time constant, in the production build the branch is dropped together with the chunk.
const MockBanner = __API_MOCK__ ? defineAsyncComponent(() => import('~/components/shell/MockBanner.vue')) : undefined

// The SidebarProvider writes the cookie `sidebar_state`; here only reading for the first render (useCookie returns 'false' as a boolean).
// Deliberately uncontrolled (default-open): with v-model:open the provider would write the old value into the cookie.
// Without an own cookie the setting "collapsed by default" applies (Settings > Appearance).
const state = useCookie('sidebar_state')
const collapsedDefault = useCookie('sidebar_default_collapsed')
const defaultOpen = state.value == null ? String(collapsedDefault.value) !== 'true' : String(state.value) !== 'false'
</script>

<template>
  <SidebarProvider :default-open="defaultOpen" class="min-h-screen">
    <a href="#inhalt" class="sr-only z-50 rounded-sm bg-card px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Zum Inhalt</a>
    <AppSidebar />
    <SidebarInset id="inhalt" tabindex="-1" class="min-w-0 overflow-x-clip !bg-background">
      <component :is="MockBanner" v-if="MockBanner" />
      <div class="flex min-w-0 flex-1 flex-col gap-4 px-4 pt-4 pb-8 min-[700px]:px-6 lg:px-8">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
