<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

const model = defineModel<number>({ default: 0 })
const { t } = useI18n()
const opts = computed<Array<[string, string]>>(() => [['0', t('common.autoRefresh.off')], ['15', '15 s'], ['30', '30 s'], ['60', t('common.autoRefresh.oneMinute')]])
</script>

<template>
  <div class="flex items-center gap-2">
    <Label for="auto-refresh" class="text-[13px] text-muted-foreground">{{ $t('common.autoRefresh.label') }}</Label>
    <Select :model-value="String(model)" @update:model-value="(v) => (model = Number(v))">
      <SelectTrigger id="auto-refresh" class="w-28"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="[v, l] in opts" :key="v" :value="v">{{ l }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
