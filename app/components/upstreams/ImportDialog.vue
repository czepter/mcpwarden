<script setup lang="ts">
import type { UpstreamImportItem, UpstreamImportResult } from '#shared/api-types'
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { upstreamApi } from '~/api'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Textarea } from '~/components/ui/textarea'
import { typeLabel } from '~/lib/labels'

// Import of an existing client config ({ "mcpServers": { ... } }): first a dry run (what would be created, what is skipped and why), then the real import.
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ imported: [r: UpstreamImportResult] }>()
const { t } = useI18n()
const text = ref('')
const preview = ref<UpstreamImportResult | null>(null)
const errorText = ref('')
const busy = ref(false)
watch(open, (o) => { if (o) { text.value = ''; preview.value = null; errorText.value = '' } })
watch(text, () => { preview.value = null; errorText.value = '' })

async function run(dryRun: boolean) {
  busy.value = true; errorText.value = ''
  try {
    const r = await upstreamApi.importJson({ json: text.value, dryRun })
    if (dryRun) { preview.value = r; return }
    open.value = false
    toast[r.skipped ? 'warning' : 'success'](t('upstreams.import.done', { created: r.created, skipped: r.skipped }))
    emit('imported', r)
  } catch (e) {
    errorText.value = (e as Error).message || t('upstreams.import.failed')
  } finally { busy.value = false }
}
const label = (i: UpstreamImportItem) => (i.status === 'skipped' ? t('upstreams.import.skipped') : i.status === 'would_create' ? t('upstreams.import.wouldCreate') : t('upstreams.import.created'))
const note = (i: UpstreamImportItem) => (i.status === 'skipped' ? i.message : (i.notes ?? []).join(' · '))
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="import-dialog">
      <DialogHeader>
        <DialogTitle>{{ $t('upstreams.import.title') }}</DialogTitle>
        <DialogDescription>{{ $t('upstreams.import.description') }}</DialogDescription>
      </DialogHeader>
      <label for="import-json" class="text-sm font-medium">{{ $t('upstreams.import.label') }}</label>
      <Textarea id="import-json" v-model="text" class="mono min-h-48 text-xs" spellcheck="false" :placeholder="'{\n  &quot;mcpServers&quot;: {\n    &quot;sentry&quot;: { &quot;url&quot;: &quot;https://mcp.sentry.dev/mcp&quot; }\n  }\n}'" />
      <Alert v-if="errorText" variant="destructive" role="alert"><AlertDescription>{{ errorText }}</AlertDescription></Alert>
      <div v-if="preview" class="overflow-x-auto rounded-sm border" data-testid="import-preview">
        <table class="w-full text-sm">
          <caption class="sr-only">{{ $t('upstreams.import.previewCaption') }}</caption>
          <thead class="bg-table-head text-xs text-muted-foreground"><tr><th scope="col" class="px-3 py-2 text-left font-medium">{{ $t('upstreams.import.colName') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('upstreams.import.colType') }}</th><th scope="col" class="px-3 text-left font-medium">{{ $t('upstreams.import.colResult') }}</th></tr></thead>
          <tbody>
            <tr v-for="i in preview.items" :key="i.name" class="border-t">
              <td class="px-3 py-2"><span class="font-medium">{{ i.name }}</span><span v-if="i.slug" class="mono block text-xs text-muted-foreground">{{ i.slug }}</span></td>
              <td class="px-3">{{ i.type ? typeLabel(i.type) : '–' }}</td>
              <td class="px-3 text-[13px]"><span class="font-medium" :class="i.status === 'skipped' ? 'text-warn-fg' : 'text-st-healthy-fg'">{{ label(i) }}</span><span v-if="note(i)" class="block text-secondary-foreground">{{ note(i) }}</span></td>
            </tr>
          </tbody>
        </table>
        <p v-if="preview.items.some(i => i.type === 'stdio' && i.status !== 'skipped')" class="border-t bg-muted px-3 py-2 text-[13px] text-secondary-foreground" data-testid="import-stdio-note">{{ $t('upstreams.import.stdioNote') }}</p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" @click="open = false">{{ $t('upstreams.form.cancel') }}</Button>
        <Button v-if="!preview" type="button" :disabled="busy || !text.trim()" @click="run(true)">{{ $t('upstreams.import.check') }}</Button>
        <Button v-else type="button" :disabled="busy || !preview.created" data-testid="import-confirm" @click="run(false)">{{ $t('upstreams.import.confirm', { n: preview.created }, preview.created) }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
