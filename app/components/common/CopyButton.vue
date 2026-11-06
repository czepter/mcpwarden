<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import { Button } from '~/components/ui/button'

const props = defineProps<{ value: string, label?: string }>()
const done = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function copy() {
  await navigator.clipboard.writeText(props.value)
  done.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (done.value = false), 1500)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <Button type="button" variant="outline" @click="copy">
    <span class="relative inline-flex size-4" aria-hidden="true">
      <Copy class="absolute inset-0 size-4 transition-all duration-200" :class="done ? 'scale-50 opacity-0' : 'scale-100 opacity-100'" />
      <Check class="absolute inset-0 size-4 transition-all duration-200" :class="done ? 'scale-100 opacity-100' : 'scale-50 opacity-0'" />
    </span>
    <!-- both labels share one grid cell, so the button keeps the width of the longer one -->
    <span class="inline-grid" aria-live="polite">
      <span class="col-start-1 row-start-1 transition-opacity duration-150" :class="done && 'opacity-0'" :aria-hidden="done">{{ label ?? $t('common.copy') }}</span>
      <span class="col-start-1 row-start-1 transition-opacity duration-150" :class="!done && 'opacity-0'" :aria-hidden="!done">{{ $t('common.copied') }}</span>
    </span>
  </Button>
</template>
