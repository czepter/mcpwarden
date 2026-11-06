<script setup lang="ts">
import { useSlidingIndicator } from '~/composables/useSlidingIndicator'

const tabs = [['common.adminTabs.users', '/admin/users'], ['common.adminTabs.oauth', '/admin/oauth'], ['common.adminTabs.instance', '/admin/settings']] as const
const route = useRoute()
const nav = ref<HTMLElement | null>(null)
const bar = useSlidingIndicator(nav, () => route.path)
</script>

<template>
  <nav ref="nav" :aria-label="$t('common.adminTabs.label')" class="relative flex gap-1 border-b">
    <NuxtLink
      v-for="[l, to] in tabs" :key="to" :to="to" :aria-current="route.path === to ? 'page' : undefined" :data-active="route.path === to"
      class="inline-flex h-11 items-center px-4 text-sm font-medium transition-colors"
      :class="route.path === to ? 'text-primary' : 'text-secondary-foreground hover:text-foreground'"
    >
      {{ $t(l) }}
    </NuxtLink>
    <span aria-hidden="true" class="slide-indicator absolute -bottom-px left-0 h-0.5 bg-primary" :style="bar" />
  </nav>
  <p class="rounded-sm border bg-card px-3 py-2 text-[13px] text-muted-foreground" data-testid="admin-hint">
    {{ $t('common.adminTabs.hint') }}
  </p>
</template>
