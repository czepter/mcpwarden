<script setup lang="ts">
import { meApi } from '~/api'
import { toast } from 'vue-sonner'
import CopyButton from '~/components/common/CopyButton.vue'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import DataSection from '~/components/common/DataSection.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import StatusDot from '~/components/common/StatusDot.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { scopeLabel } from '~/lib/labels'
import type { ConnectionSummary } from '#shared/api-types'

const { t } = useI18n()
useHead({ title: () => `${t('settings.connections.title')} · mcpwarden` })
const { data, error, status, refresh } = useApi('connections', meApi.connections)
const caps = useApi('caps', meApi.capabilities)
const cmd = computed(() => `claude mcp add --transport http mcpwarden ${caps.data.value?.mcpUrl ?? ''}`)
const revoke = ref<ConnectionSummary | null>(null)
async function doRevoke() {
  if (!revoke.value) return
  try { await meApi.revokeConnection(revoke.value.clientId); toast.success(t('settings.connections.revoked')); await refresh() } catch { toast.error(t('settings.connections.revokeFailed')) }
  revoke.value = null
}
</script>

<template>
  <PageHeader :title="$t('settings.connections.title')" :description="$t('settings.connections.description')" />
  <DataSection :title="$t('settings.connections.sectionTitle')" min-width="760px">
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
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('settings.connections.colClient') }}</TableHead><TableHead scope="col">{{ $t('settings.connections.colStatus') }}</TableHead><TableHead scope="col">{{ $t('settings.connections.colAuthorized') }}</TableHead><TableHead scope="col">{{ $t('settings.connections.colLastConnected') }}</TableHead><TableHead scope="col">{{ $t('settings.connections.colPermission') }}</TableHead><TableHead scope="col"><span class="sr-only">{{ $t('settings.connections.colActions') }}</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="c in data.items" :key="c.clientId">
          <TableCell><div class="font-medium">{{ c.name }}</div><div class="mono text-xs text-muted-foreground">{{ c.redirectHost }}</div></TableCell>
          <TableCell><StatusDot :active="c.active" /></TableCell>
          <TableCell><RelativeTime :value="c.grantedAt" /></TableCell>
          <TableCell><RelativeTime :value="c.lastUsedAt" :empty="$t('settings.connections.never')" /></TableCell>
          <TableCell>{{ c.scopes.filter(s => s.startsWith('mcp')).map(scopeLabel).join(', ') }}</TableCell>
          <TableCell class="text-right"><Button variant="destructive-outline" :aria-label="$t('settings.connections.revokeLabel', { name: c.name })" @click="revoke = c">{{ $t('settings.connections.revoke') }}</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>
  <ConfirmDialog :open="!!revoke" :title="$t('settings.connections.confirmTitle')" :confirm-label="$t('settings.connections.revoke')" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
    {{ $t('settings.connections.confirmBody', { name: revoke?.name }) }}
  </ConfirmDialog>
</template>
