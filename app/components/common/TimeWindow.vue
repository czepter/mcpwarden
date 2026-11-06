<script setup lang="ts">
import type { StatsWindow } from '#shared/api-types'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useSlidingIndicator } from '~/composables/useSlidingIndicator'

const model = defineModel<StatsWindow>({ required: true })
const items: Array<[StatsWindow, string]> = [['5m', '5 min'], ['1h', '1 h'], ['24h', '24 h'], ['7d', '7 d']]
const root = ref<HTMLElement | null>(null)
const pill = useSlidingIndicator(root, () => model.value)
</script>

<template>
  <div ref="root" class="relative inline-flex">
    <span aria-hidden="true" class="slide-indicator pointer-events-none absolute inset-y-0 left-0 rounded-md bg-accent" :style="pill" />
    <ToggleGroup v-model="model" type="single" variant="outline" class="relative" :aria-label="$t('common.timeWindow.label')" @update:model-value="(v) => { if (!v) model = model }">
      <ToggleGroupItem v-for="[v, l] in items" :key="v" :value="v" :data-active="model === v" class="h-11 min-w-12 bg-transparent px-3 data-[state=on]:bg-transparent">{{ l }}</ToggleGroupItem>
    </ToggleGroup>
  </div>
</template>
