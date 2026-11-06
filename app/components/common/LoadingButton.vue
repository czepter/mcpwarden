<script setup lang="ts">
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

// Keeps its size while busy: the label stays in the layout (invisible), the spinner sits on top.
defineProps<{ busy?: boolean, variant?: InstanceType<typeof Button>['$props']['variant'], type?: 'button' | 'submit' }>()
</script>

<template>
  <Button :type="type ?? 'submit'" :variant="variant" class="relative" :disabled="busy" :aria-busy="busy || undefined">
    <span class="inline-flex items-center gap-2 transition-opacity duration-150" :class="busy && 'opacity-0'"><slot /></span>
    <Spinner v-if="busy" class="absolute inset-0 m-auto" aria-hidden="true" />
  </Button>
</template>
