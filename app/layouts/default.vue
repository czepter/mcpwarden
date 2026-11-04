<script setup lang="ts">
import { SidebarInset, SidebarProvider } from '~/components/ui/sidebar'
import AppSidebar from '~/components/shell/AppSidebar.vue'
import MockBanner from '~/components/shell/MockBanner.vue'

// Cookie `sidebar_state` schreibt der SidebarProvider; hier nur das Lesen fuer den ersten Render.
const cookie = useCookie('sidebar_state')
const open = ref(cookie.value !== 'false')
</script>

<template>
  <SidebarProvider v-model:open="open" class="min-h-screen">
    <a href="#inhalt" class="sr-only z-50 rounded-sm bg-card px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">Zum Inhalt</a>
    <AppSidebar />
    <SidebarInset id="inhalt" tabindex="-1" class="min-w-0 !bg-background">
      <MockBanner />
      <div class="flex flex-1 flex-col gap-4 px-4 pt-4 pb-8 min-[700px]:px-6 lg:px-8">
        <slot />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
