<script setup lang="ts">
import { ChevronDown } from '@lucide/vue'
import { Button } from '~/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '~/components/ui/dropdown-menu'

// Mockup: "Tags ⌄" next to Status and Typ; several tags can be ticked, an upstream matches when it carries ALL ticked tags.
const model = defineModel<string[]>({ required: true })
defineProps<{ options: string[] }>()
const toggle = (tag: string, on: boolean) => { model.value = on ? [...model.value, tag] : model.value.filter(t => t !== tag) }
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="outline" data-testid="tags-filter" :aria-label="$t('upstreams.list.filterTags')">{{ model.length ? $t('upstreams.list.tagsCount', { n: model.length }) : $t('upstreams.list.tags') }}<ChevronDown class="size-4" aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="max-h-72 min-w-48 overflow-y-auto">
      <p v-if="!options.length" class="px-2 py-1.5 text-[13px] text-muted-foreground">{{ $t('upstreams.list.noTags') }}</p>
      <template v-else>
        <DropdownMenuLabel class="text-xs font-semibold text-muted-foreground">{{ $t('upstreams.list.tagsHint') }}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem v-for="o in options" :key="o" :model-value="model.includes(o)" @select.prevent @update:model-value="(v) => toggle(o, !!v)">{{ o }}</DropdownMenuCheckboxItem>
        <template v-if="model.length"><DropdownMenuSeparator /><button type="button" class="w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" @click="model = []">{{ $t('upstreams.list.tagsClear') }}</button></template>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
