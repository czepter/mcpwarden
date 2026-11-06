<script setup lang="ts">
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'

// Mock mode only (build constant); role and scenario live in localStorage, switching reloads.
const spec = __API_MOCK__
const role = ref(import.meta.client ? localStorage.getItem('mockRole') ?? 'admin' : 'admin')
const scenario = ref(import.meta.client ? localStorage.getItem('mockScenario') ?? 'default' : 'default')
function set(k: string, v: string) { localStorage.setItem(k, v); location.reload() }
</script>

<template>
  <div v-if="spec" class="flex flex-wrap items-center gap-3 border-b border-warn-border bg-warn-bg px-4 py-1.5 text-xs text-warn-fg" data-testid="mock-banner">
    <strong>{{ $t('common.mock.title') }}</strong>
    <span>{{ $t('common.mock.domains', { spec }) }}</span>
    <label class="flex items-center gap-1.5">{{ $t('common.mock.role') }}
      <Select :model-value="role" @update:model-value="(v) => set('mockRole', String(v))">
        <SelectTrigger class="h-8 w-24 text-xs" :aria-label="$t('common.mock.roleLabel')"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="user">{{ $t('common.role.user') }}</SelectItem></SelectContent>
      </Select>
    </label>
    <label class="flex items-center gap-1.5">{{ $t('common.mock.scenario') }}
      <Select :model-value="scenario" @update:model-value="(v) => set('mockScenario', String(v))">
        <SelectTrigger class="h-8 w-28 text-xs" :aria-label="$t('common.mock.scenarioLabel')"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem v-for="s in ['default', 'empty', 'error', 'slow', 'forbidden', 'huge']" :key="s" :value="s">{{ s }}</SelectItem></SelectContent>
      </Select>
    </label>
  </div>
</template>
