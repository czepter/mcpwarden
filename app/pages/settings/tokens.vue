<script setup lang="ts">
import { meApi } from '~/api'
import { toast } from 'vue-sonner'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import FormRow from '~/components/common/FormRow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import OneTimeSecret from '~/components/common/OneTimeSecret.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useZodForm } from '~/lib/useZodForm'
import { patSchema } from '~/lib/zod-schemas'
import type { PatSummary } from '#shared/api-types'

useHead({ title: 'Tokens · mcpwarden' })
const { data, error, status, refresh } = useApi('pats', meApi.pats)
const created = ref<{ name: string, token: string } | null>(null)
const dialog = ref(false)
const revoke = ref<PatSummary | null>(null)
const { form, formError, busy, submit } = useZodForm(patSchema, { name: '' })
const [name] = form.defineField('name')
const full = computed(() => (data.value ? data.value.limit.active >= data.value.limit.max : false))
const onCreate = submit(async (v) => {
  const p = await meApi.createPat(v.name)
  created.value = { name: p.name, token: p.token }
  dialog.value = false; form.resetForm(); await refresh()
}, ['name'])
async function doRevoke() {
  if (!revoke.value) return
  try { await meApi.revokePat(revoke.value.id); toast.success('Token widerrufen.'); await refresh() } catch { toast.error('Widerrufen fehlgeschlagen.') }
  revoke.value = null
}
</script>

<template>
  <PageHeader title="Personal Access Tokens" crumb="Tokens" description="Für Clients ohne OAuth. Ein Token gilt nur für dich.">
    <Button :disabled="full" @click="dialog = true">+ Token erzeugen</Button>
  </PageHeader>
  <OneTimeSecret v-if="created" :title="`Token „${created.name}“ erzeugt`" :value="created.token" @close="created = null" />
  <p v-if="data && full" role="status" class="text-[13px] text-muted-foreground">Du hast die Obergrenze von {{ data.limit.max }} aktiven Tokens erreicht. Widerrufe eines, um ein neues zu erzeugen.</p>
  <DataSection title="Deine Tokens" min-width="640px">
    <LoadingRows v-if="status === 'pending' && !data" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <EmptyState v-else-if="!data?.items.length" title="Noch keine Tokens" text="Erzeuge ein Token, um Clients ohne OAuth zu verbinden." />
    <Table v-else>
      <caption class="sr-only">Personal Access Tokens</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">Name</TableHead><TableHead scope="col">Beginnt mit</TableHead><TableHead scope="col">Erstellt</TableHead><TableHead scope="col">Zuletzt benutzt</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col"><span class="sr-only">Aktionen</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="p in data.items" :key="p.id">
          <TableCell class="font-medium">{{ p.name }}</TableCell>
          <TableCell><code class="text-xs">{{ p.prefix }}…</code></TableCell>
          <TableCell><RelativeTime :value="p.createdAt" /></TableCell>
          <TableCell><RelativeTime :value="p.lastUsedAt" empty="nie" /></TableCell>
          <TableCell>{{ p.revokedAt ? 'Widerrufen' : 'Aktiv' }}</TableCell>
          <TableCell class="text-right"><Button v-if="!p.revokedAt" variant="destructive-outline" :aria-label="`Token ${p.name} widerrufen`" @click="revoke = p">Widerrufen</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>
  <Dialog v-model:open="dialog">
    <DialogContent>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="onCreate">
        <DialogHeader><DialogTitle>Token benennen</DialogTitle><DialogDescription>Der Name hilft dir später, das Token wiederzuerkennen.</DialogDescription></DialogHeader>
        <p v-if="formError" role="alert" class="text-sm text-destructive">{{ formError }}</p>
        <FormRow id="pat-name" label="Name" :error="form.errors.value.name">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="name" maxlength="64" autocomplete="off" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <DialogFooter><Button type="button" variant="outline" @click="dialog = false">Abbrechen</Button><Button type="submit" :disabled="busy">Erzeugen</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
  <ConfirmDialog :open="!!revoke" title="Token widerrufen?" confirm-label="Widerrufen" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
    Clients mit dem Token „{{ revoke?.name }}“ verlieren sofort den Zugriff.
  </ConfirmDialog>
</template>
