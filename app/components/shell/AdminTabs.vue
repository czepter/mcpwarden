<script setup lang="ts">
const tabs = [['common.adminTabs.users', '/admin/users'], ['common.adminTabs.oauth', '/admin/oauth'], ['common.adminTabs.instance', '/admin/settings']] as const
const route = useRoute()
</script>

<template>
  <!-- Mockup: plain link tabs, active one in the text color with a 2px accent underline over the 1px rule. -->
  <nav :aria-label="$t('common.adminTabs.label')" class="flex flex-wrap gap-1 border-b">
    <NuxtLink
      v-for="[l, to] in tabs" :key="to" :to="to" :aria-current="route.path === to ? 'page' : undefined" :data-active="route.path === to"
      class="-mb-px inline-flex min-h-11 items-center border-b-2 px-3.5 text-sm font-medium"
      :class="route.path === to ? 'border-primary text-foreground' : 'border-transparent text-secondary-foreground hover:text-foreground'"
    >
      {{ $t(l) }}
    </NuxtLink>
  </nav>
</template>
