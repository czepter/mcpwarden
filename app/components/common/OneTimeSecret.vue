<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { Button } from '~/components/ui/button'
import CopyButton from './CopyButton.vue'

// Der Wert lebt nur als Prop dieser Komponente; Schliessen entfernt ihn (Abschnitt 10 Regel 4).
defineProps<{ title: string, value: string }>()
const emit = defineEmits<{ close: [] }>()
onBeforeUnmount(() => emit('close'))
</script>

<template>
  <div role="status" class="flex flex-col gap-2 rounded-lg border border-[#86efac] bg-[#dcfce7] px-4 py-3 text-[#14532d]" data-testid="one-time-secret">
    <div class="font-semibold">{{ title }}</div>
    <div class="flex flex-wrap items-center gap-2">
      <code class="rounded-sm bg-white/70 px-2 py-1 text-[13px] select-all" data-testid="one-time-value">{{ value }}</code>
      <CopyButton :value="value" />
      <Button type="button" variant="outline" @click="emit('close')">Schließen</Button>
    </div>
    <p class="text-[13px]">Du siehst diesen Wert nur jetzt. Danach ist er nicht mehr abrufbar.</p>
  </div>
</template>
