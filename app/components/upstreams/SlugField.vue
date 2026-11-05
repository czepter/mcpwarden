<script setup lang="ts">
import { computed } from 'vue'
import { Input } from '~/components/ui/input'

defineProps<{ id: string, invalid?: boolean, describedby?: string, disabled?: boolean }>()
const model = defineModel<string>({ default: '' })
const preview = computed(() => `${model.value || 'kurzname'}__tool`)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Input :id="id" v-model="model" class="mono" maxlength="32" autocomplete="off" spellcheck="false" :disabled="disabled" :aria-invalid="invalid || undefined" :aria-describedby="describedby" />
    <div class="flex justify-between text-xs text-muted-foreground">
      <span>Tool-Namen: <code>{{ preview }}</code></span>
      <span class="tnum" aria-live="polite">{{ model.length }}/32</span>
    </div>
  </div>
</template>
