<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from '@lucide/vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'
import { Button } from '~/components/ui/button'

// Mockup: an outlined button "Auto-Refresh ⌄" that opens the interval choice.
const model = defineModel<number>({ default: 0 })
const { t } = useI18n()
const opts = computed<Array<[string, string]>>(() => [['0', t('common.autoRefresh.off')], ['15', '15 s'], ['30', '30 s'], ['60', t('common.autoRefresh.oneMinute')]])
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button id="auto-refresh" variant="outline" :title="opts.find(o => o[0] === String(model))?.[1]">{{ $t('common.autoRefresh.label') }}<ChevronDown class="size-4" aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup :model-value="String(model)" @update:model-value="(v) => (model = Number(v))">
        <DropdownMenuRadioItem v-for="[v, l] in opts" :key="v" :value="v">{{ l }}</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
