<script setup lang="ts">
import { Skeleton } from '~/components/ui/skeleton'

withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
</script>

<template>
  <div class="flex flex-col gap-3 p-5" aria-busy="true" role="status" data-testid="loading">
    <span class="sr-only">{{ $t('common.loading') }}</span>
    <Skeleton v-for="i in rows" :key="i" class="h-9 w-full" />
  </div>
</template>
