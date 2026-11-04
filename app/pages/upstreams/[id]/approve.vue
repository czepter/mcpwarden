<script setup lang="ts">
import { toast } from 'vue-sonner'
import { upstreamApi } from '~/api'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'

useHead({ title: 'stdio-Freigabe · mcpwarden' })
const id = String(useRoute().params.id)
const draft = useApi(`draft-${id}`, () => upstreamApi.draft(id))
const discard = ref(false)
async function approve() { try { await upstreamApi.approve(id); toast.success('Freigegeben. Der Prozess startet beim ersten Aufruf.'); await navigateTo(`/upstreams/${id}`) } catch { toast.error('Freigabe fehlgeschlagen.') } }
async function doDiscard() { try { await upstreamApi.remove(id); await navigateTo('/upstreams') } catch { toast.error('Verwerfen fehlgeschlagen.') } discard.value = false }
</script>

<template>
  <ErrorState v-if="draft.error.value" :error="draft.error.value" @retry="draft.refresh()" />
  <LoadingRows v-else-if="!draft.data.value" />
  <template v-else>
    <PageHeader :title="`${draft.data.value.slug} wartet auf Freigabe`" :crumbs="[{ label: 'Upstreams', to: '/upstreams' }]" />
    <Alert role="alert" class="border-[#fcd34d] bg-[#fef3c7] text-[#78350f]"><strong>Dieser Upstream startet einen Prozess auf dem Server.</strong> Prüfe Befehl und Umgebung genau, bevor du freigibst.</Alert>
    <section class="flex max-w-[600px] flex-col gap-3 rounded-lg border bg-card p-5" aria-labelledby="h-draft">
      <h2 id="h-draft" class="text-[15px] font-semibold">Entwurf</h2>
      <dl class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt class="text-muted-foreground">Befehl</dt><dd class="mono text-xs">{{ draft.data.value.command }} {{ draft.data.value.args.join(' ') }}</dd>
        <dt class="text-muted-foreground">Arbeitsordner</dt><dd class="mono text-xs">{{ draft.data.value.cwd }}</dd>
        <dt class="text-muted-foreground">Umgebung</dt><dd class="mono text-xs">{{ draft.data.value.envNames.join(', ') || 'keine' }} (Werte bleiben geheim)</dd>
        <dt class="text-muted-foreground">Herkunft</dt><dd>{{ draft.data.value.createdVia.client }}, <RelativeTime :value="draft.data.value.createdVia.at" /></dd>
      </dl>
      <ul class="list-disc pl-5 text-[13px] text-secondary-foreground"><li>Der Befehl ist mir bekannt und stammt von mir.</li><li>Der Prozess startet erst beim ersten Aufruf und endet bei Leerlauf.</li><li>stdio ist nicht durch den SSRF-Schutz begrenzt, der Prozess darf ins Netz.</li></ul>
      <div class="flex justify-end gap-2"><Button variant="destructive-outline" @click="discard = true">Verwerfen</Button><Button @click="approve">Freigeben</Button></div>
    </section>
    <ConfirmDialog :open="discard" title="Entwurf verwerfen?" confirm-label="Verwerfen" description="Der Entwurf wird gelöscht." @update:open="discard = $event" @confirm="doDiscard" />
  </template>
</template>
