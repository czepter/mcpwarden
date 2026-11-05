<script setup lang="ts">
import type { UpstreamTestResult } from '#shared/api-types'
import { formatMs } from '~/lib/format'

defineProps<{ result: UpstreamTestResult }>()
const HINT: Record<string, string> = {
  ssrf_blocked: 'Ziel nicht erlaubt (SSRF-Schutz). Ein Admin kann Ausnahmen unter Admin › Instanz eintragen.',
  unauthorized: 'Die Anmeldedaten wurden abgelehnt. Ersetze das Secret im Tab „Auth“.',
  awaiting_auth: 'Es fehlen noch Anmeldedaten.',
}
</script>

<template>
  <div v-if="result.ok" role="status" class="rounded-lg border border-ok-border bg-ok-bg px-4 py-3 text-ok-fg" data-testid="test-ok">
    <div class="font-semibold">Verbindung erfolgreich: {{ result.tools.length }} Tools gefunden ({{ formatMs(result.latencyMs) }})</div>
    <ul class="mono mt-1 flex flex-wrap gap-x-3 text-xs">
      <li v-for="t in result.tools.slice(0, 12)" :key="t.name">{{ t.name }}</li>
      <li v-if="result.tools.length > 12">… und {{ result.tools.length - 12 }} weitere</li>
    </ul>
  </div>
  <div v-else role="alert" class="rounded-lg border border-err-border bg-err-bg px-4 py-3 text-err-fg" data-testid="test-error">
    <div class="font-semibold">Verbindung fehlgeschlagen</div>
    <div class="text-[13px]">{{ result.message }}</div>
    <div v-if="HINT[result.errorCode]" class="text-[13px]">{{ HINT[result.errorCode] }}</div>
    <code class="text-xs">{{ result.errorCode }}</code>
  </div>
</template>
