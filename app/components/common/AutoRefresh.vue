<script setup lang="ts">
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

const model = defineModel<number>({ default: 0 })
const opts: Array<[string, string]> = [['0', 'Aus'], ['15', '15 s'], ['30', '30 s'], ['60', '1 min']]
</script>

<template>
  <div class="flex items-center gap-2">
    <Label for="auto-refresh" class="text-[13px] text-muted-foreground">Auto-Refresh</Label>
    <Select :model-value="String(model)" @update:model-value="(v) => (model = Number(v))">
      <SelectTrigger id="auto-refresh" class="w-28"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem v-for="[v, l] in opts" :key="v" :value="v">{{ l }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
