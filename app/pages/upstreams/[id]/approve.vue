<script setup lang="ts">
import { toast } from 'vue-sonner'
import { meApi, upstreamApi } from '~/api'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { formatDateTime } from '~/lib/format'
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
  <!-- Draft: one 600 px card (back link, heading, state, warning, facts, checklist, buttons). -->
  <div v-else class="mx-auto flex w-full max-w-[600px] flex-col gap-5 rounded-lg border bg-card p-7">
    <div class="flex flex-col gap-1">
      <NuxtLink to="/upstreams" class="text-[13px] text-secondary-foreground">‹ {{ $t('upstreams.list.title') }}</NuxtLink>
      <h1 class="mt-1 text-xl font-semibold tracking-tight">{{ $t('upstreams.approve.heading', { slug: draft.data.value.slug }) }}</h1>
      <div class="flex items-center gap-2 font-medium text-st-degraded-fg"><span class="size-2 rounded-full bg-st-degraded-fg" aria-hidden="true" />{{ $t('upstreams.approve.state') }}</div>
    </div>
    <Alert role="alert" class="gap-1 border-0 bg-warn-bg text-warn-fg">
      <strong>{{ $t('upstreams.approve.warnStrong') }}</strong>
      <div>{{ $t('upstreams.approve.origin', { client: draft.data.value.createdVia.client, at: formatDateTime(draft.data.value.createdVia.at) }) }} {{ $t('upstreams.approve.warnRest') }}</div>
    </Alert>
    <dl class="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2.5">
      <dt class="text-secondary-foreground">{{ $t('upstreams.approve.command') }}</dt><dd><code class="mono block rounded-sm bg-muted px-2.5 py-2 text-[13px] [overflow-wrap:anywhere]">{{ draft.data.value.command }} {{ draft.data.value.args.join(' ') }}</code></dd>
      <dt class="text-secondary-foreground">{{ $t('upstreams.approve.cwd') }}</dt><dd class="mono text-[13px] [overflow-wrap:anywhere]">{{ draft.data.value.cwd }}</dd>
      <dt class="text-secondary-foreground">{{ $t('upstreams.approve.env') }}</dt><dd>{{ draft.data.value.envNames.length ? $t('upstreams.approve.envSet', { names: draft.data.value.envNames.join(', ') }) : $t('upstreams.approve.envNone') }}</dd>
      <dt class="text-secondary-foreground">{{ $t('upstreams.approve.network') }}</dt><dd>{{ $t('upstreams.approve.networkText') }}</dd>
    </dl>
    <StdioChecklist v-if="caps.data.value" :caps="caps.data.value" />
    <p v-else-if="caps.error.value" role="status" class="text-[13px] text-muted-foreground">{{ $t('upstreams.approve.capsError') }}</p>
    <div class="flex flex-wrap justify-end gap-2"><Button variant="destructive-outline" @click="discard = true">{{ $t('upstreams.approve.discard') }}</Button><Button :disabled="blocked" class="px-5" @click="approve">{{ $t('upstreams.approve.approve') }}</Button></div>
    <ConfirmDialog :open="discard" :title="$t('upstreams.approve.discardTitle')" :confirm-label="$t('upstreams.approve.discard')" :description="$t('upstreams.approve.discardText')" @update:open="discard = $event" @confirm="doDiscard" />
  </div>
</template>
