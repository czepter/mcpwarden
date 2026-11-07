<script setup lang="ts">
import { toast } from 'vue-sonner'
import { meApi, upstreamApi } from '~/api'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import StdioChecklist from '~/components/upstreams/StdioChecklist.vue'

definePageMeta({ middleware: 'phase2' })
const { t } = useI18n()
useHead({ title: () => `${t('upstreams.approve.title')} · mcpwarden` })
const id = String(useRoute().params.id)
const draft = useApi(`draft-${id}`, () => upstreamApi.draft(id))
const caps = useApi('caps', meApi.capabilities)
const blocked = computed(() => caps.data.value?.stdio.allowed === false)
const discard = ref(false)
async function approve() { try { await upstreamApi.approve(id); toast.success(t('upstreams.approve.approved')); await navigateTo(`/upstreams/${id}`) } catch { toast.error(t('upstreams.approve.approveFailed')) } }
async function doDiscard() { try { await upstreamApi.remove(id); await navigateTo('/upstreams') } catch { toast.error(t('upstreams.approve.discardFailed')) } discard.value = false }
</script>

<template>
  <ErrorState v-if="draft.error.value" :error="draft.error.value" @retry="draft.refresh()" />
  <LoadingRows v-else-if="!draft.data.value" />
  <template v-else>
    <PageHeader :title="$t('upstreams.approve.heading', { slug: draft.data.value.slug })" :crumbs="[{ label: $t('upstreams.list.title'), to: '/upstreams' }]" />
    <Alert role="alert" class="border-warn-border bg-warn-bg text-warn-fg"><strong>{{ $t('upstreams.approve.warnStrong') }}</strong> {{ $t('upstreams.approve.warnRest') }}</Alert>
    <div class="flex max-w-[600px] flex-col gap-4">
    <StdioChecklist v-if="caps.data.value" :caps="caps.data.value" />
    <p v-else-if="caps.error.value" role="status" class="text-[13px] text-muted-foreground">{{ $t('upstreams.approve.capsError') }}</p>
    <section class="flex w-full max-w-[600px] flex-col gap-3 rounded-lg border bg-card p-5" aria-labelledby="h-draft">
      <h2 id="h-draft" class="text-[15px] font-semibold">{{ $t('upstreams.approve.draft') }}</h2>
      <dl class="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt class="text-muted-foreground">{{ $t('upstreams.approve.command') }}</dt><dd class="mono text-xs">{{ draft.data.value.command }} {{ draft.data.value.args.join(' ') }}</dd>
        <dt class="text-muted-foreground">{{ $t('upstreams.approve.cwd') }}</dt><dd class="mono text-xs">{{ draft.data.value.cwd }}</dd>
        <dt class="text-muted-foreground">{{ $t('upstreams.approve.env') }}</dt><dd class="mono text-xs">{{ draft.data.value.envNames.join(', ') || $t('upstreams.approve.envNone') }} {{ $t('upstreams.approve.envSecret') }}</dd>
        <dt class="text-muted-foreground">{{ $t('upstreams.approve.origin') }}</dt><dd>{{ draft.data.value.createdVia.client }}, <RelativeTime :value="draft.data.value.createdVia.at" /></dd>
      </dl>
      <ul class="list-disc pl-5 text-[13px] text-secondary-foreground"><li>{{ $t('upstreams.approve.check1') }}</li><li>{{ $t('upstreams.approve.check2') }}</li><li>{{ $t('upstreams.approve.check3') }}</li></ul>
      <div class="flex justify-end gap-2"><Button variant="destructive-outline" @click="discard = true">{{ $t('upstreams.approve.discard') }}</Button><Button :disabled="blocked" @click="approve">{{ $t('upstreams.approve.approve') }}</Button></div>
    </section>
    </div>
    <ConfirmDialog :open="discard" :title="$t('upstreams.approve.discardTitle')" :confirm-label="$t('upstreams.approve.discard')" :description="$t('upstreams.approve.discardText')" @update:open="discard = $event" @confirm="doDiscard" />
  </template>
</template>
