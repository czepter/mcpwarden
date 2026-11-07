<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '~/components/ui/button'

const props = defineProps<{ error: unknown }>()
defineEmits<{ retry: [] }>()
// useAsyncData wraps errors (NuxtError): therefore read out only statusCode, message and code.
const err = computed(() => {
  const e = props.error as { statusCode?: number, message?: string, code?: string, data?: { code?: string } } | null
  return e && typeof e === 'object' ? { statusCode: e.statusCode ?? 0, message: e.message ?? '', code: e.data?.code ?? e.code ?? 'unknown' } : null
})
const forbidden = computed(() => err.value?.statusCode === 403)
const notFound = computed(() => err.value?.statusCode === 404)
</script>

<template>
  <div role="alert" class="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="error-state">
    <h3 class="text-[15px] font-semibold">
      {{ forbidden ? $t('common.errorState.forbiddenTitle') : notFound ? $t('common.errorState.notFoundTitle') : $t('common.errorState.genericTitle') }}
    </h3>
    <p class="max-w-md text-[13px] text-muted-foreground">
      {{ forbidden ? $t('common.errorState.forbidden') : notFound ? $t('common.errorState.notFound') : (err?.message ?? $t('common.errorState.unknown')) }}
    </p>
    <code v-if="err && !forbidden && !notFound" class="text-xs text-muted-foreground">{{ err.code }} · {{ err.statusCode }}</code>
    <Button v-if="!forbidden && !notFound" variant="outline" class="mt-2" @click="$emit('retry')">{{ $t('common.retry') }}</Button>
  </div>
</template>
