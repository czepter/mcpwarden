<script setup lang="ts">
import type { StatsWindow } from '#shared/api-types'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

const model = defineModel<StatsWindow>({ required: true })
const items: Array<[StatsWindow, string]> = [['5m', '5 min'], ['1h', '1 h'], ['24h', '24 h'], ['7d', '7 d']]
</script>

<template>
  <ToggleGroup v-model="model" type="single" variant="outline" aria-label="Zeitfenster" @update:model-value="(v) => { if (!v) model = model }">
    <ToggleGroupItem v-for="[v, l] in items" :key="v" :value="v" class="h-11 min-w-12 px-3">{{ l }}</ToggleGroupItem>
  </ToggleGroup>
</template>
