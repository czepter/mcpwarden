<script setup lang="ts">
import type { UpstreamTestResult } from '#shared/api-types'
import { formatMs } from '~/lib/format'

const { t } = useI18n()

defineProps<{ result: UpstreamTestResult }>()
const hint = (code: string): string | undefined => ({
  ssrf_blocked: t('upstreams.test.hintSsrf'),
  unauthorized: t('upstreams.test.hintUnauthorized'),
  awaiting_auth: t('upstreams.test.hintAwaitingAuth'),
} as Record<string, string>)[code]
</script>

<template>
  <div v-if="result.ok" role="status" class="rounded-lg border border-ok-border bg-ok-bg px-4 py-3 text-ok-fg" data-testid="test-ok">
    <div class="font-semibold">{{ $t('upstreams.test.ok', { n: result.tools.length, latency: formatMs(result.latencyMs) }, result.tools.length) }}</div>
    <ul class="mono mt-1 flex flex-wrap gap-x-3 text-xs">
      <li v-for="t in result.tools.slice(0, 12)" :key="t.name">{{ t.name }}</li>
      <li v-if="result.tools.length > 12">{{ $t('upstreams.test.more', { n: result.tools.length - 12 }) }}</li>
    </ul>
  </div>
  <div v-else role="alert" class="rounded-lg border border-err-border bg-err-bg px-4 py-3 text-err-fg" data-testid="test-error">
    <div class="font-semibold">{{ $t('upstreams.test.failed') }}</div>
    <div class="text-[13px]">{{ result.message }}</div>
    <div v-if="hint(result.errorCode)" class="text-[13px]">{{ hint(result.errorCode) }}</div>
    <code class="text-xs">{{ result.errorCode }}</code>
  </div>
</template>
