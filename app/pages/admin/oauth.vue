<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import type { DcrMode, OAuthClientAdmin } from '#shared/api-types'
import { toast } from 'vue-sonner'
import { adminApi } from '~/api'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import FormRow from '~/components/common/FormRow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import AdminTabs from '~/components/shell/AdminTabs.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { RadioGroup, RadioGroupItem } from '~/components/ui/radio-group'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Textarea } from '~/components/ui/textarea'
import { useZodForm } from '~/lib/useZodForm'
import { allowlistSchema } from '~/lib/zod-schemas'

definePageMeta({ middleware: 'admin' })
const { t } = useI18n()
useHead({ title: () => t('admin.oauth.pageTitle') })
const policy = useApi('dcr-policy', adminApi.policy)
const allow = useApi('dcr-allow', adminApi.allowlist)
const clients = useApi('dcr-clients', adminApi.clients)
const MODES: DcrMode[] = ['off', 'allowlist', 'open']
async function setMode(m: unknown) { try { await adminApi.setPolicy(m as DcrMode); await policy.refresh(); toast.success(t('admin.oauth.modeSaved')) } catch { toast.error(t('admin.oauth.saveFailed')) } }

const dialog = ref(false)
const f = useZodForm(allowlistSchema, { label: '', namePattern: '', redirects: '' })
const [label] = f.form.defineField('label')
const [namePattern] = f.form.defineField('namePattern')
const [redirects] = f.form.defineField('redirects')
const add = f.submit(async (v) => {
  await adminApi.addAllow({ label: v.label, namePattern: v.namePattern, redirectPatterns: v.redirects.split('\n').map(s => s.trim()).filter(Boolean) })
  dialog.value = false; f.form.resetForm(); await allow.refresh()
}, ['label', 'namePattern'])
async function removeAllow(id: string) { try { await adminApi.removeAllow(id); await allow.refresh() } catch { toast.error(t('admin.oauth.removeFailed')) } }
const revoke = ref<OAuthClientAdmin | null>(null)
async function doRevoke() {
  if (!revoke.value) return
  try { await adminApi.revokeClient(revoke.value.id); toast.success(t('admin.oauth.revoked')); await clients.refresh() } catch { toast.error(t('admin.oauth.revokeFailed')) }
  revoke.value = null
}
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null)
</script>

<template>
  <PageHeader :title="$t('admin.title')" />
  <AdminTabs />
  <section class="rounded-lg border bg-card p-5" aria-labelledby="h-mode">
    <h2 id="h-mode" class="mb-1 text-base font-semibold">{{ $t('admin.oauth.dcrTitle') }}</h2>
    <p class="mb-3 text-[13px] text-muted-foreground">{{ $t('admin.oauth.dcrNote') }}</p>
    <RadioGroup v-if="policy.data.value" :model-value="policy.data.value.mode" :aria-label="$t('admin.oauth.modeAria')" class="gap-2" @update:model-value="setMode">
      <label v-for="m in MODES" :key="m" class="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5" :class="policy.data.value.mode === m ? 'border-primary bg-primary-tint' : 'bg-card'">
        <RadioGroupItem :value="m" class="mt-0.5" /><span><span class="block font-medium">{{ $t(`admin.oauth.modes.${m}.label`) }}</span><span class="block text-[13px] text-secondary-foreground">{{ $t(`admin.oauth.modes.${m}.desc`) }}</span></span>
      </label>
    </RadioGroup>
    <ErrorState v-else-if="policy.error.value" :error="policy.error.value" @retry="policy.refresh()" />
    <Alert v-if="policy.data.value?.mode === 'open'" class="mt-3 border-warn-border bg-warn-bg text-[13px] text-warn-fg">{{ $t('admin.oauth.openWarning') }}</Alert>
  </section>

  <DataSection :title="$t('admin.oauth.allowlist')" min-width="720px">
    <template #actions><Button @click="dialog = true">{{ $t('admin.oauth.addEntry') }}</Button></template>
    <LoadingRows v-if="allow.status.value === 'pending' && !allow.data.value" :rows="3" />
    <EmptyState v-else-if="!allow.data.value?.items.length" :title="$t('admin.oauth.allowlistEmpty')" />
    <Table v-else>
      <caption class="sr-only">{{ $t('admin.oauth.allowlist') }}</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('admin.oauth.col.label') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.namePattern') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.redirectPattern') }}</TableHead><TableHead scope="col"><span class="sr-only">{{ $t('admin.oauth.col.actions') }}</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="e in allow.data.value.items" :key="e.id">
          <TableCell class="font-medium">{{ e.label }}</TableCell><TableCell><code class="text-xs">{{ e.namePattern }}</code></TableCell>
          <TableCell><div v-for="r in e.redirectPatterns" :key="r"><code class="text-xs">{{ r }}</code></div></TableCell>
          <TableCell class="text-right"><Button variant="ghost" size="icon" class="text-destructive" :aria-label="$t('admin.oauth.removeEntryAria', { label: e.label })" @click="removeAllow(e.id)"><span aria-hidden="true" class="text-lg">✕</span></Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <DataSection :title="$t('admin.oauth.registeredClients')" min-width="900px">
    <LoadingRows v-if="clients.status.value === 'pending' && !clients.data.value" />
    <ErrorState v-else-if="clients.error.value" :error="clients.error.value" @retry="clients.refresh()" />
    <EmptyState v-else-if="!clients.data.value?.items.length" :title="$t('admin.oauth.noClients')" />
    <Table v-else>
      <caption class="sr-only">{{ $t('admin.oauth.registeredClients') }}</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('admin.oauth.col.name') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.redirectUris') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.created') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.lastUsed') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.users') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.allowlist') }}</TableHead><TableHead scope="col">{{ $t('admin.oauth.col.expiry') }}</TableHead><TableHead scope="col"><span class="sr-only">{{ $t('admin.oauth.col.actions') }}</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="c in clients.data.value.items" :key="c.id">
          <TableCell class="font-medium">{{ c.name }}</TableCell>
          <TableCell><div v-for="u in c.redirectUris" :key="u"><code class="text-xs">{{ u }}</code></div></TableCell>
          <TableCell><RelativeTime :value="c.createdAt" /></TableCell><TableCell><RelativeTime :value="c.lastUsedAt" :empty="$t('admin.oauth.never')" /></TableCell>
          <TableCell class="tnum">{{ c.userCount }}</TableCell><TableCell>{{ c.allowlisted ? $t('admin.oauth.inAllowlist') : $t('admin.oauth.notInAllowlist') }}</TableCell>
          <TableCell>{{ c.expiresAt ? $t('admin.oauth.expiresIn', { n: daysLeft(c.expiresAt) }, daysLeft(c.expiresAt) ?? 0) : '–' }}</TableCell>
          <TableCell class="text-right"><Button variant="destructive-outline" :aria-label="$t('admin.oauth.revokeAria', { name: c.name })" @click="revoke = c">{{ $t('admin.oauth.revoke') }}</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <Dialog v-model:open="dialog">
    <DialogContent>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="add">
        <DialogHeader><DialogTitle>{{ $t('admin.oauth.entryDialogTitle') }}</DialogTitle><DialogDescription>{{ $t('admin.oauth.entryDialogDesc') }}</DialogDescription></DialogHeader>
        <p v-if="f.formError.value" role="alert" class="text-sm text-destructive">{{ f.formError.value }}</p>
        <FormRow id="al-label" :label="$t('admin.oauth.col.label')" :error="f.form.errors.value.label"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="label" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="al-name" :label="$t('admin.oauth.col.namePattern')" :error="f.form.errors.value.namePattern"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="namePattern" class="mono" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="al-redir" :label="$t('admin.oauth.col.redirectPattern')" :error="f.form.errors.value.redirects"><template #default="{ id, invalid, describedby }"><Textarea :id="id" v-model="redirects" rows="3" class="mono" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <DialogFooter><Button type="button" variant="outline" @click="dialog = false">{{ $t('admin.oauth.cancel') }}</Button><LoadingButton :busy="f.busy.value">{{ $t('admin.oauth.add') }}</LoadingButton></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
  <ConfirmDialog :open="!!revoke" :title="$t('admin.oauth.revokeConfirmTitle')" :confirm-label="$t('admin.oauth.revoke')" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
    {{ $t('admin.oauth.revokeConfirmBody', { name: revoke?.name }) }}
  </ConfirmDialog>
</template>
