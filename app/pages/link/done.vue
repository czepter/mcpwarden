<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: 'phase2' })
const { t } = useI18n()
useHead({ title: () => t('auth.done.docTitle'), meta: [{ name: 'robots', content: 'noindex' }] })
const status = String(useRoute().query.status ?? 'connected')
const key = ['connected', 'unsupported'].includes(status) ? status : 'error'
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7">
    <h1 class="mb-2 text-lg font-semibold">{{ $t(`auth.done.${key}.title`) }}</h1>
    <p :role="status === 'connected' ? 'status' : 'alert'" class="text-[13px]">{{ $t(`auth.done.${key}.text`) }}</p>
  </div>
</template>
