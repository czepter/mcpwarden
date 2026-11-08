<script setup lang="ts">
import type { StatsWindow } from '#shared/api-types'
import { ChevronDown } from '@lucide/vue'
import { Button } from '~/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { useSlidingIndicator } from '~/composables/useSlidingIndicator'

const model = defineModel<StatsWindow>({ required: true })
// variant 'menu': outlined button "Letzte Stunde ⌄" with the choice in a menu (dashboard, upstreams, detail); 'tabs': segmented control (statistics).
const props = withDefaults(defineProps<{ variant?: 'tabs' | 'menu' }>(), { variant: 'tabs' })
const long = computed<Record<StatsWindow, string>>(() => ({ '5m': t('common.timeWindow.last5m'), '1h': t('common.timeWindow.last1h'), '24h': t('common.timeWindow.last24h'), '7d': t('common.timeWindow.last7d') }))
const { t } = useI18n()
const items: Array<[StatsWindow, string]> = [['5m', '5 min'], ['1h', '1 h'], ['24h', '24 h'], ['7d', '7 d']]
const root = ref<HTMLElement | null>(null)
const pill = useSlidingIndicator(root, () => model.value)
</script>

<template>
  <DropdownMenu v-if="props.variant === 'menu'">
    <DropdownMenuTrigger as-child>
      <Button variant="outline" :aria-label="$t('common.timeWindow.label')">{{ long[model] }}<ChevronDown class="size-4" aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup :model-value="model" @update:model-value="(v) => (model = v as StatsWindow)">
        <DropdownMenuRadioItem v-for="[v] in items" :key="v" :value="v">{{ long[v] }}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
  <div v-else ref="root" class="relative inline-flex">
    <span aria-hidden="true" class="slide-indicator pointer-events-none absolute inset-y-0 left-0 rounded-md bg-accent" :style="pill" />
    <ToggleGroup v-model="model" type="single" variant="outline" class="relative" :aria-label="$t('common.timeWindow.label')" @update:model-value="(v) => { if (!v) model = model }">
      <ToggleGroupItem v-for="[v, l] in items" :key="v" :value="v" :data-active="model === v" class="h-11 min-w-12 bg-transparent px-3 data-[state=on]:bg-transparent">{{ l }}</ToggleGroupItem>
    </ToggleGroup>
  </div>
</template>
