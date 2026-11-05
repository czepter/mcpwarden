<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'
import { ref } from 'vue'
import { Button } from '~/components/ui/button'

const props = defineProps<{ value: string, label?: string }>()
const done = ref(false)
async function copy() {
  await navigator.clipboard.writeText(props.value)
  done.value = true
  setTimeout(() => (done.value = false), 1500)
}
</script>

<template>
  <Button type="button" variant="outline" @click="copy">
    <component :is="done ? Check : Copy" class="size-4" aria-hidden="true" />
    {{ done ? 'Kopiert' : (label ?? 'Kopieren') }}
  </Button>
</template>
