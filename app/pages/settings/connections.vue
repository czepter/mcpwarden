<script setup lang="ts">
import { meApi } from '~/api'
import { toast } from 'vue-sonner'
import CopyButton from '~/components/common/CopyButton.vue'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import DataSection from '~/components/common/DataSection.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import DeviceNameDialog from '~/components/common/DeviceNameDialog.vue'
import { Button } from '~/components/ui/button'
import { Pencil } from '@lucide/vue'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { scopeLabel } from '~/lib/labels'
import type { ConnectionSummary, ToolMode } from '#shared/api-types'

const { t } = useI18n()
useHead({ title: () => `${t('settings.connections.title')} · mcpwarden` })
const { data, error, status, refresh } = useApi('connections', meApi.connections)
const caps = useApi('caps', meApi.capabilities)
const cmd = computed(() => `claude mcp add --transport http mcpwarden ${caps.data.value?.mcpUrl ?? ''}`)
const MODES = ['direct', 'meta'] as const
const settings = useApi('me-settings', meApi.settings)
const mode = ref<ToolMode>('direct')
watch(() => settings.data.value?.toolMode, (m) => { if (m) mode.value = m }, { immediate: true })
const modeBusy = ref(false)
// Optimistic: the radio moves at once and snaps back if the server refuses.
async function setMode(m: ToolMode) {
  if (m === mode.value || modeBusy.value) return
  const prev = mode.value
  mode.value = m; modeBusy.value = true
  try {
    const r = await meApi.patchSettings({ toolMode: m })
    mode.value = r.toolMode ?? m
    toast.success(t(m === 'meta' ? 'settings.connections.modeSavedMeta' : 'settings.connections.modeSavedDirect'))
  } catch { mode.value = prev; toast.error(t('settings.connections.modeFailed')) } finally { modeBusy.value = false }
}
const revoke = ref<ConnectionSummary | null>(null)
const rename = ref<ConnectionSummary | null>(null)
async function doRevoke() {
  if (!revoke.value) return
  try { await meApi.revokeConnection(revoke.value.clientId); toast.success(t('settings.connections.revoked')); await refresh() } catch { toast.error(t('settings.connections.revokeFailed')) }
  revoke.value = null
}
</script>

<template>
  <PageHeader :title="$t('settings.connections.title')" />
  <section :aria-label="$t('settings.connections.modeTitle')" class="flex flex-col gap-3 rounded-lg border bg-card px-5 py-4">
    <div><h2 class="text-[15px] font-semibold">{{ $t('settings.connections.modeTitle') }}</h2><p class="text-[13px] text-muted-foreground">{{ $t('settings.connections.modeDesc') }}</p></div>
    <fieldset class="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3">
      <legend class="sr-only">{{ $t('settings.connections.modeTitle') }}</legend>
      <label v-for="m in MODES" :key="m" class="flex items-start gap-3 rounded-sm border px-3.5 py-3" :class="m === mode ? 'cursor-pointer border-primary bg-primary/10' : 'cursor-pointer'">
        <input type="radio" name="tool-mode" :value="m" :checked="m === mode" :disabled="modeBusy || !settings.data.value" class="mt-0.5 size-[18px] accent-primary" :data-testid="`mode-${m}`" @change="setMode(m)">
        <span><span class="block font-semibold">{{ $t(`settings.connections.mode_${m}`) }}</span><span class="block text-[13px] text-secondary-foreground">{{ $t(`settings.connections.mode_${m}Desc`) }}</span><span class="mt-1 block text-xs text-muted-foreground">{{ $t(`settings.connections.mode_${m}Note`) }}</span></span>
      </label>
    </fieldset>
  </section>
  <DataSection :title="$t('settings.connections.sectionTitle')" :description="$t('settings.connections.sectionDesc')" min-width="760px">
    <LoadingRows v-if="status === 'pending' && !data" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <div v-else-if="!data?.items.length" class="px-6 py-8" data-testid="connect-guide">
      <div class="mx-auto flex max-w-xl flex-col gap-4 text-[13px]">
        <div class="text-center">
          <h3 class="text-[15px] font-semibold">{{ $t('settings.connections.emptyTitle') }}</h3>
          <p class="mt-1 text-muted-foreground">{{ $t('settings.connections.emptyIntro') }}</p>
        </div>
        <ol class="flex flex-col gap-4">
          <li class="flex flex-col gap-2">
            <span class="font-medium">{{ $t('settings.connections.step1') }}</span>
            <div class="flex flex-wrap items-center gap-2">
              <code class="mono rounded-sm bg-muted px-2 py-1 text-xs break-all" data-testid="setup-cmd">{{ cmd }}</code>
              <CopyButton v-if="caps.data.value" :value="cmd" :label="$t('settings.connections.copyCommand')" />
            </div>
            <span class="text-muted-foreground">{{ $t('settings.connections.otherClients') }}</span>
            <div class="flex flex-wrap items-center gap-2">
              <code class="mono rounded-sm bg-muted px-2 py-1 text-xs break-all" data-testid="mcp-url">{{ caps.data.value?.mcpUrl }}</code>
              <CopyButton v-if="caps.data.value" :value="caps.data.value.mcpUrl" :label="$t('settings.connections.copyUrl')" />
            </div>
          </li>
          <li><span class="font-medium">{{ $t('settings.connections.step2Label') }}</span> <i18n-t keypath="settings.connections.step2Text" tag="span"><template #cmd><code class="mono rounded-sm bg-muted px-1 text-xs">/mcp</code></template></i18n-t></li>
          <li><span class="font-medium">{{ $t('settings.connections.step3Label') }}</span> {{ $t('settings.connections.step3Text') }}</li>
        </ol>
        <p class="text-muted-foreground"><i18n-t keypath="settings.connections.noOauth" tag="span"><template #link><NuxtLink to="/settings/tokens" class="text-primary underline">{{ $t('settings.connections.tokensLink') }}</NuxtLink></template><template #header><code class="mono text-xs">Authorization: Bearer …</code></template></i18n-t></p>
      </div>
    </div>
    <Table v-else>
      <caption class="sr-only">{{ $t('settings.connections.sectionTitle') }}</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('settings.connections.colClient') }}</TableHead><TableHead scope="col">{{ $t('settings.connections.colAuthorized') }}</TableHead><TableHead scope="col">{{ $t('settings.connections.colLastConnected') }}</TableHead><TableHead scope="col">{{ $t('settings.connections.colPermission') }}</TableHead><TableHead scope="col"><span class="sr-only">{{ $t('settings.connections.colActions') }}</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="c in data.items" :key="c.clientId">
          <TableCell><div class="font-medium">{{ c.name }}</div><div class="flex items-center gap-1 text-xs text-muted-foreground"><span :class="!c.deviceName && 'mono'">{{ c.deviceName ?? c.redirectHost }}</span><button type="button" class="inline-flex size-6 items-center justify-center rounded-sm hover:bg-accent" :aria-label="$t('common.device.edit', { name: c.name })" data-testid="rename-device" @click="rename = c"><Pencil class="size-3.5" aria-hidden="true" /></button></div></TableCell>
          <TableCell><RelativeTime :value="c.grantedAt" /></TableCell>
          <TableCell><span class="inline-flex items-center gap-2 font-medium" :class="c.active ? 'text-st-healthy-fg' : 'text-secondary-foreground'"><span class="size-2 rounded-full" :class="c.active ? 'bg-st-healthy-bar' : 'bg-st-disabled-dot'" aria-hidden="true" /><RelativeTime :value="c.lastUsedAt" :empty="$t('settings.connections.never')" /></span></TableCell>
          <TableCell>{{ c.scopes.filter(s => s.startsWith('mcp')).map(scopeLabel).join(', ') }}</TableCell>
          <TableCell class="text-right"><Button variant="destructive-outline" :aria-label="$t('settings.connections.revokeLabel', { name: c.name })" @click="revoke = c">{{ $t('settings.connections.revoke') }}</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>
  <ConfirmDialog :open="!!revoke" :title="$t('settings.connections.confirmTitle')" :confirm-label="$t('settings.connections.revoke')" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
    {{ $t('settings.connections.confirmBody', { name: revoke?.name }) }}
  </ConfirmDialog>
<DeviceNameDialog :open="!!rename" :subject="rename?.name ?? ''" :initial="rename?.deviceName ?? null" :save="(n) => meApi.renameConnection(rename!.clientId, n)" @update:open="(v) => !v && (rename = null)" @saved="refresh()" />
</template>
