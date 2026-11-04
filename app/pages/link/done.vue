<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: 'Fertig · mcpwarden', meta: [{ name: 'robots', content: 'noindex' }] })
const status = String(useRoute().query.status ?? 'connected')
const TEXT: Record<string, [string, string]> = {
  connected: ['Verbunden', 'Die Zugangsdaten sind gespeichert. Du kannst zurück ins Coding-Tool.'],
  unsupported: ['Nicht unterstützt', 'Dieser Upstream unterstützt die Anmeldung per OAuth nicht.'],
  error: ['Fehlgeschlagen', 'Die Anmeldung ist fehlgeschlagen. Lass dir einen neuen Link geben.'],
}
const t = TEXT[status] ?? TEXT.error!
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7">
    <h1 class="mb-2 text-lg font-semibold">{{ t[0] }}</h1>
    <p :role="status === 'connected' ? 'status' : 'alert'" class="text-[13px]">{{ t[1] }}</p>
  </div>
</template>
