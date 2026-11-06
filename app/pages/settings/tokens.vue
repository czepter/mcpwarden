<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import { meApi, upstreamApi } from '~/api'
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
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { useZodForm } from '~/lib/useZodForm'
import { patSchema } from '~/lib/zod-schemas'
import type { PatSummary } from '#shared/api-types'

const { t } = useI18n()
useHead({ title: () => `${t('settings.tokens.title')} · mcpwarden` })
const { data, error, status, refresh } = useApi('pats', meApi.pats)
const created = ref<{ name: string, token: string } | null>(null)
const dialog = ref(false)
const revoke = ref<PatSummary | null>(null)
const ups = useApi('upstreams', upstreamApi.list)
const EXPIRY = computed<Array<[string, string]>>(() => [['30', t('settings.tokens.expiry30')], ['90', t('settings.tokens.expiry90')], ['365', t('settings.tokens.expiry365')], ['never', t('settings.tokens.expiryNever')]])
const expiry = ref('90')
const allUpstreams = ref(true)
const picked = ref<string[]>([])
const scopeError = ref('')
const upstreamName = (id: string) => ups.data.value?.items.find(u => u.id === id)?.name ?? t('settings.tokens.deleted')
function toggle(id: string, on: boolean | 'indeterminate') { picked.value = on === true ? [...new Set([...picked.value, id])] : picked.value.filter(x => x !== id) }
watch(dialog, (o) => { if (o) { expiry.value = '90'; allUpstreams.value = true; picked.value = []; scopeError.value = '' } })
const { form, formError, busy, submit } = useZodForm(patSchema, { name: '' })
const [name] = form.defineField('name')
const full = computed(() => (data.value ? data.value.limit.active >= data.value.limit.max : false))
const onCreate = submit(async (v) => {
  if (!allUpstreams.value && !picked.value.length) { scopeError.value = t('settings.tokens.pickUpstream'); return }
  scopeError.value = ''
  const p = await meApi.createPat({ name: v.name, expiresInDays: expiry.value === 'never' ? null : Number(expiry.value), upstreamIds: allUpstreams.value ? null : picked.value })
  created.value = { name: p.name, token: p.token }
  dialog.value = false; form.resetForm(); await refresh()
}, ['name'])
async function doRevoke() {
  if (!revoke.value) return
  try { await meApi.revokePat(revoke.value.id); toast.success(t('settings.tokens.revoked')); await refresh() } catch { toast.error(t('settings.tokens.revokeFailed')) }
  revoke.value = null
}
</script>

<template>
  <PageHeader :title="$t('settings.tokens.pageTitle')" :crumb="$t('settings.tokens.title')" :description="$t('settings.tokens.description')">
    <Button :disabled="full" @click="dialog = true">{{ $t('settings.tokens.create') }}</Button>
  </PageHeader>
  <OneTimeSecret v-if="created" :title="$t('settings.tokens.createdTitle', { name: created.name })" :value="created.token" @close="created = null" />
  <p v-if="data && full" role="status" class="text-[13px] text-muted-foreground">{{ $t('settings.tokens.limitReached', { max: data.limit.max }) }}</p>
  <DataSection :title="$t('settings.tokens.sectionTitle')" min-width="640px">
    <LoadingRows v-if="status === 'pending' && !data" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <EmptyState v-else-if="!data?.items.length" :title="$t('settings.tokens.emptyTitle')" :text="$t('settings.tokens.emptyText')" />
    <Table v-else>
      <caption class="sr-only">{{ $t('settings.tokens.pageTitle') }}</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('settings.tokens.colName') }}</TableHead><TableHead scope="col">{{ $t('settings.tokens.colPrefix') }}</TableHead><TableHead scope="col">{{ $t('settings.tokens.colCreated') }}</TableHead><TableHead scope="col">{{ $t('settings.tokens.colLastUsed') }}</TableHead><TableHead scope="col">{{ $t('settings.tokens.colValidUntil') }}</TableHead><TableHead scope="col">{{ $t('settings.tokens.colAccess') }}</TableHead><TableHead scope="col">{{ $t('settings.tokens.colStatus') }}</TableHead><TableHead scope="col"><span class="sr-only">{{ $t('settings.tokens.colActions') }}</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="p in data.items" :key="p.id">
          <TableCell class="font-medium">{{ p.name }}</TableCell>
          <TableCell><code class="text-xs">{{ p.prefix }}…</code></TableCell>
          <TableCell><RelativeTime :value="p.createdAt" /></TableCell>
          <TableCell><RelativeTime :value="p.lastUsedAt" :empty="$t('settings.tokens.never')" /></TableCell>
          <TableCell><RelativeTime :value="p.expiresAt" :empty="$t('settings.tokens.never')" /></TableCell>
          <TableCell>{{ p.upstreamIds ? p.upstreamIds.map(upstreamName).join(', ') : $t('settings.tokens.allUpstreams') }}</TableCell>
          <TableCell>{{ p.revokedAt ? $t('settings.tokens.statusRevoked') : (p.expiresAt && new Date(p.expiresAt) <= new Date()) ? $t('settings.tokens.statusExpired') : $t('settings.tokens.statusActive') }}</TableCell>
          <TableCell class="text-right"><Button v-if="!p.revokedAt" variant="destructive-outline" :aria-label="$t('settings.tokens.revokeLabel', { name: p.name })" @click="revoke = p">{{ $t('settings.tokens.revoke') }}</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>
  <Dialog v-model:open="dialog">
    <DialogContent>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="onCreate">
        <DialogHeader><DialogTitle>{{ $t('settings.tokens.dialogTitle') }}</DialogTitle><DialogDescription>{{ $t('settings.tokens.dialogDesc') }}</DialogDescription></DialogHeader>
        <p v-if="formError" role="alert" class="text-sm text-destructive">{{ formError }}</p>
        <FormRow id="pat-name" :label="$t('settings.tokens.fieldName')" :error="form.errors.value.name">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="name" maxlength="64" autocomplete="off" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <FormRow id="pat-expiry" :label="$t('settings.tokens.fieldExpiry')">
          <template #default="{ id }">
            <Select v-model="expiry">
              <SelectTrigger :id="id" class="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem v-for="[v, l] in EXPIRY" :key="v" :value="v">{{ l }}</SelectItem></SelectContent>
            </Select>
          </template>
        </FormRow>
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-1 text-sm font-medium">{{ $t('settings.tokens.fieldAccess') }}</legend>
          <div class="flex items-center gap-2"><Checkbox id="pat-all" :model-value="allUpstreams" @update:model-value="(v) => (allUpstreams = v === true)" /><Label for="pat-all" class="font-normal">{{ $t('settings.tokens.allUpstreams') }}</Label></div>
          <template v-if="!allUpstreams">
            <p v-if="!ups.data.value?.items.length" class="text-[13px] text-muted-foreground">{{ $t('settings.tokens.noUpstreams') }}</p>
            <div v-for="u in ups.data.value?.items ?? []" :key="u.id" class="flex items-center gap-2 pl-6">
              <Checkbox :id="`pat-up-${u.id}`" :model-value="picked.includes(u.id)" @update:model-value="(v) => toggle(u.id, v)" /><Label :for="`pat-up-${u.id}`" class="font-normal">{{ u.name }}</Label>
            </div>
            <p v-if="scopeError" role="alert" class="text-sm text-destructive">{{ scopeError }}</p>
          </template>
        </fieldset>
        <DialogFooter><Button type="button" variant="outline" @click="dialog = false">{{ $t('settings.tokens.cancel') }}</Button><LoadingButton :busy="busy">{{ $t('settings.tokens.submit') }}</LoadingButton></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
  <ConfirmDialog :open="!!revoke" :title="$t('settings.tokens.confirmTitle')" :confirm-label="$t('settings.tokens.confirmLabel')" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
    {{ $t('settings.tokens.confirmBody', { name: revoke?.name }) }}
  </ConfirmDialog>
</template>
