<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { formatDateTime, formatRelative } from '~/lib/format'

const props = defineProps<{ value: string | null | undefined, empty?: string }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval>
onMounted(() => { timer = setInterval(() => (now.value = Date.now()), 5000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <time v-if="props.value" :datetime="props.value" :title="formatDateTime(props.value)">{{ formatRelative(props.value, now) }}</time>
  <span v-else>{{ empty ?? '–' }}</span>
</template>
