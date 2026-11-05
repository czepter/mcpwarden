<script setup lang="ts">
const tabs = [['Nutzer', '/admin/users'], ['Clients (DCR)', '/admin/oauth'], ['Instanz', '/admin/settings']] as const
const route = useRoute()
</script>

<template>
  <nav aria-label="Admin-Bereiche" class="flex gap-1 border-b">
    <NuxtLink
      v-for="[l, to] in tabs" :key="to" :to="to" :aria-current="route.path === to ? 'page' : undefined"
      class="-mb-px inline-flex h-11 items-center border-b-2 px-4 text-sm font-medium"
      :class="route.path === to ? 'border-primary text-primary' : 'border-transparent text-secondary-foreground hover:text-foreground'"
    >
      {{ l }}
    </NuxtLink>
  </nav>
  <p class="rounded-sm border bg-card px-3 py-2 text-[13px] text-muted-foreground" data-testid="admin-hint">
    Du siehst hier nur Metadaten. Inhalte und Zugangsdaten der Nutzer sind für Admins nicht einsehbar.
  </p>
</template>
