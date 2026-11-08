<script setup lang="ts">
import { X } from '@lucide/vue'
import { ref } from 'vue'
import { Input } from '~/components/ui/input'

// Free-text tags: Enter or comma adds, Backspace on an empty field removes the last one. Normalised like the server (trim, lowercase, no duplicates).
const model = defineModel<string[]>({ required: true })
const props = withDefaults(defineProps<{ id?: string, suggestions?: string[], max?: number }>(), { id: undefined, suggestions: () => [], max: 10 })
const draft = ref('')
const MAX_LEN = 32
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_LEN)
function add(raw: string) {
  const t = norm(raw)
  if (t && !model.value.includes(t) && model.value.length < props.max) model.value = [...model.value, t]
  draft.value = ''
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(draft.value) } else if (e.key === 'Backspace' && !draft.value && model.value.length) model.value = model.value.slice(0, -1)
}
const listId = `${props.id ?? 'tags'}-list`
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="tags-input">
    <ul v-if="model.length" class="flex flex-wrap gap-1.5" :aria-label="$t('upstreams.form.tags')">
      <li v-for="t in model" :key="t" class="inline-flex items-center gap-1 rounded-sm border bg-muted py-0.5 pr-0.5 pl-2 text-[13px]">
        {{ t }}
        <button type="button" class="flex size-6 items-center justify-center rounded-sm hover:bg-accent" :aria-label="$t('upstreams.form.tagRemove', { tag: t })" @click="model = model.filter(x => x !== t)"><X class="size-3.5" aria-hidden="true" /></button>
      </li>
    </ul>
    <Input :id="id" v-model="draft" :list="listId" :maxlength="MAX_LEN" :placeholder="$t('upstreams.form.tagsPlaceholder')" :disabled="model.length >= max" @keydown="onKey" @blur="add(draft)" />
    <datalist :id="listId"><option v-for="s in suggestions.filter(x => !model.includes(x))" :key="s" :value="s" /></datalist>
  </div>
</template>
