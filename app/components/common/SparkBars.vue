<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{ items: Array<'ok' | 'warn' | 'err' | 'none'> }>()
const col = { ok: 'var(--st-healthy-bar)', warn: 'var(--st-degraded-bar)', err: 'var(--st-open-bar)', none: 'var(--st-disabled-bar)' }
const { t } = useI18n()
const text = computed(() => {
  const err = props.items.filter(i => i === 'err' || i === 'warn').length
  return t('common.spark', { total: props.items.length, ok: props.items.filter(i => i === 'ok').length, err })
})
</script>

<template>
  <span class="inline-flex items-center gap-0.5">
    <span class="sr-only">{{ text }}</span>
    <span v-for="(b, i) in items" :key="i" aria-hidden="true" class="h-5 w-1 rounded-[2px] transition-colors duration-300" :style="{ background: col[b] }" />
  </span>
</template>
