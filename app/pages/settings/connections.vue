<script setup lang="ts">
import { meApi } from '~/api'
import { toast } from 'vue-sonner'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import StatusDot from '~/components/common/StatusDot.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { scopeLabel } from '~/lib/labels'
import type { ConnectionSummary } from '#shared/api-types'

useHead({ title: 'Clients · mcpwarden' })
const { data, error, status, refresh } = useApi('connections', meApi.connections)
const revoke = ref<ConnectionSummary | null>(null)
async function doRevoke() {
  if (!revoke.value) return
  try { await meApi.revokeConnection(revoke.value.clientId); toast.success('Zugriff widerrufen.'); await refresh() } catch { toast.error('Widerrufen fehlgeschlagen.') }
  revoke.value = null
}
</script>

<template>
  <PageHeader title="Clients" description="Programme, die du per OAuth autorisiert hast." />
  <DataSection title="Autorisierte Clients" min-width="760px">
    <LoadingRows v-if="status === 'pending' && !data" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <EmptyState v-else-if="!data?.items.length" title="Noch keine Clients" text="Sobald du einem Client den Zugriff erlaubst, erscheint er hier." />
    <Table v-else>
      <caption class="sr-only">Autorisierte Clients</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">Client</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col">Autorisiert</TableHead><TableHead scope="col">Zuletzt verbunden</TableHead><TableHead scope="col">Berechtigung</TableHead><TableHead scope="col"><span class="sr-only">Aktionen</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="c in data.items" :key="c.clientId">
          <TableCell><div class="font-medium">{{ c.name }}</div><div class="mono text-xs text-muted-foreground">{{ c.redirectHost }}</div></TableCell>
          <TableCell><StatusDot :active="c.active" /></TableCell>
          <TableCell><RelativeTime :value="c.grantedAt" /></TableCell>
          <TableCell><RelativeTime :value="c.lastUsedAt" empty="nie" /></TableCell>
          <TableCell>{{ c.scopes.filter(s => s.startsWith('mcp')).map(scopeLabel).join(', ') }}</TableCell>
          <TableCell class="text-right"><Button variant="destructive-outline" :aria-label="`${c.name} widerrufen`" @click="revoke = c">Widerrufen</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>
  <ConfirmDialog :open="!!revoke" title="Zugriff widerrufen?" confirm-label="Widerrufen" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
    „{{ revoke?.name }}“ verliert den Zugriff. Das wirkt beim nächsten Aufruf des Clients.
  </ConfirmDialog>
</template>
