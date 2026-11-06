<script setup lang="ts">
import { toast } from 'vue-sonner'
import { adminApi } from '~/api'
import { ApiError } from '~/api/http'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import AdminTabs from '~/components/shell/AdminTabs.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'

definePageMeta({ middleware: 'admin' })
const { t } = useI18n()
useHead({ title: () => t('admin.settings.pageTitle') })
const { data, error, status, refresh } = useApi('admin-settings', adminApi.settings)
const warnings = ref<string[]>([])
const entry = ref('')
const entryError = ref('')
async function put(b: Parameters<typeof adminApi.putSettings>[0]) {
  try {
    const r = await adminApi.putSettings(b)
    warnings.value = r.warnings.map(w => w.entry)
    await refresh(); toast.success(t('admin.settings.saved'))
    return true
  } catch (e) { entryError.value = e instanceof ApiError ? e.message : t('admin.settings.saveFailed'); return false }
}
async function addEntry() {
  entryError.value = ''
  const v = entry.value.trim().toLowerCase()
  if (!v) { entryError.value = t('admin.settings.entryRequired'); return }
  if (await put({ 'ssrf.allow': [...(data.value?.['ssrf.allow'] ?? []), v] })) entry.value = ''
}
const removeEntry = (e: string) => put({ 'ssrf.allow': (data.value?.['ssrf.allow'] ?? []).filter(x => x !== e) })
</script>

<template>
  <PageHeader :title="$t('admin.title')" />
  <AdminTabs />
  <LoadingRows v-if="status === 'pending' && !data" />
  <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
  <div v-else-if="data" class="flex max-w-[720px] flex-col gap-4">
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-stdio">
      <div class="flex items-start justify-between gap-4">
        <div><h2 id="h-stdio" class="text-base font-semibold"><label for="sw-stdio">{{ $t('admin.settings.stdioTitle') }}</label></h2>
          <p class="text-[13px] text-muted-foreground">{{ $t('admin.settings.stdioDesc') }}</p></div>
        <Switch id="sw-stdio" :model-value="data['stdio.enabled']" @update:model-value="(v) => put({ 'stdio.enabled': v })" />
      </div>
    </section>
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-ssrf">
      <h2 id="h-ssrf" class="text-base font-semibold">{{ $t('admin.settings.ssrfTitle') }}</h2>
      <p class="mb-3 text-[13px] text-muted-foreground">{{ $t('admin.settings.ssrfDesc') }}</p>
      <Alert v-for="w in warnings" :key="w" role="alert" class="mb-2 border-warn-border bg-warn-bg text-[13px] text-warn-fg">{{ $t('admin.settings.metadataWarning', { entry: w }) }}</Alert>
      <ul v-if="data['ssrf.allow'].length" class="mb-3 divide-y rounded-sm border">
        <li v-for="e in data['ssrf.allow']" :key="e" class="flex min-h-11 items-center justify-between px-3"><code class="text-xs">{{ e }}</code><Button variant="ghost" :aria-label="$t('admin.settings.removeExceptionAria', { entry: e })" @click="removeEntry(e)">{{ $t('admin.settings.remove') }}</Button></li>
      </ul>
      <p v-else class="mb-3 text-[13px]">{{ $t('admin.settings.noExceptions') }}</p>
      <form class="flex gap-2" novalidate @submit.prevent="addEntry">
        <div class="flex-1"><label for="ssrf-new" class="sr-only">{{ $t('admin.settings.newException') }}</label><Input id="ssrf-new" v-model="entry" class="mono" :placeholder="$t('admin.settings.placeholder')" :aria-invalid="!!entryError || undefined" aria-describedby="ssrf-err" /><p id="ssrf-err" role="alert" class="mt-1 text-sm text-destructive">{{ entryError }}</p></div>
        <Button type="submit">{{ $t('admin.settings.addEntry') }}</Button>
      </form>
    </section>
    <p class="text-[13px] text-muted-foreground">{{ $t('admin.settings.registrationNote') }}</p>
  </div>
</template>
