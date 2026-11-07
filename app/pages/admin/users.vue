<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import type { AdminUser } from '#shared/api-types'
import { toast } from 'vue-sonner'
import { adminApi, publicApi } from '~/api'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import DataSection from '~/components/common/DataSection.vue'
import EmptyState from '~/components/common/EmptyState.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import FormRow from '~/components/common/FormRow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import OneTimeSecret from '~/components/common/OneTimeSecret.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import AdminTabs from '~/components/shell/AdminTabs.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { formatDate } from '~/lib/format'
import { inviteStatusLabel, roleLabel } from '~/lib/labels'
import { useZodForm } from '~/lib/useZodForm'
import { inviteSchema, limitsSchema } from '~/lib/zod-schemas'

definePageMeta({ middleware: 'admin' })
const { t } = useI18n()
useHead({ title: () => t('admin.users.pageTitle') })
const { user: me } = useSessionUser()
const users = useApi('admin-users', adminApi.users)
const invites = useApi('admin-invites', adminApi.invites)
const link = ref<string | null>(null)

// Invitation
const invDialog = ref(false)
const inv = useZodForm(inviteSchema, { email: '' })
const [invEmail] = inv.form.defineField('email')
// Mail features are visible only if the server has a mailer (GET /api/public-config)
const { data: pub } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false })), { server: false })
const sendByMail = ref(false)
const createInvite = inv.submit(async (v) => {
  const r = await adminApi.createInvite(v.email || undefined, !!pub.value?.mail && sendByMail.value && !!v.email)
  link.value = r.link; invDialog.value = false; inv.form.resetForm(); sendByMail.value = false; await invites.refresh()
  if (r.mailQueued) toast.success(t('admin.users.inviteMailed'))
}, ['email'])
async function revokeInvite(id: string) { try { await adminApi.revokeInvite(id); await invites.refresh() } catch { toast.error(t('admin.users.revokeFailed')) } }

// Actions
type Pending = { kind: 'ban' | 'delete', user: AdminUser }
const pending = ref<Pending | null>(null)
const deleteStep = ref(1)
const protectedUser = (u: AdminUser) => u.id === me.value?.id || u.role === 'admin'
async function runPending() {
  const p = pending.value; if (!p) return
  if (p.kind === 'delete' && deleteStep.value === 1) { deleteStep.value = 2; return }
  try {
    if (p.kind === 'ban') await adminApi.ban(p.user.id); else await adminApi.removeUser(p.user.id)
    toast.success(p.kind === 'ban' ? t('admin.users.banned') : t('admin.users.deleted')); await users.refresh()
  } catch (e) { toast.error(e instanceof Error ? e.message : t('admin.users.actionFailed')) }
  pending.value = null; deleteStep.value = 1
}
async function unban(u: AdminUser) { try { await adminApi.unban(u.id); await users.refresh() } catch { toast.error(t('admin.users.unbanFailed')) } }
async function setStdio(u: AdminUser, v: boolean | 'indeterminate') {
  try { await adminApi.setLimits(u.id, { stdioAllowed: v === true }); await users.refresh() } catch { toast.error(t('admin.users.saveFailed')) }
}

// Limits
const limitsFor = ref<AdminUser | null>(null)
const lim = useZodForm(limitsSchema, { maxUpstreams: 50, callsPerMin: 120, maxConnections: 20, stdioMaxProcs: 5, stdioIdleMin: 10 })
const LIM_FIELDS = [['maxUpstreams', 'admin.users.limits.upstreams'], ['callsPerMin', 'admin.users.limits.callsPerMin'], ['maxConnections', 'admin.users.limits.connections'], ['stdioMaxProcs', 'admin.users.limits.stdioProcs'], ['stdioIdleMin', 'admin.users.limits.stdioIdle']] as const
function openLimits(u: AdminUser) { limitsFor.value = u; lim.form.resetForm({ values: { ...u.limits } }) }
const saveLimits = lim.submit(async (v) => {
  await adminApi.setLimits(limitsFor.value!.id, v); limitsFor.value = null; toast.success(t('admin.users.limitsSaved')); await users.refresh()
}, LIM_FIELDS.map(f => f[0]))
</script>

<template>
  <PageHeader :title="$t('admin.title')" />
  <AdminTabs />
  <OneTimeSecret v-if="link" :title="$t('admin.users.inviteCreated')" :value="link" @close="link = null" />

  <DataSection :title="$t('admin.users.users')" min-width="860px">
    <LoadingRows v-if="users.status.value === 'pending' && !users.data.value" />
    <ErrorState v-else-if="users.error.value" :error="users.error.value" @retry="users.refresh()" />
    <Table v-else-if="users.data.value">
      <caption class="sr-only">{{ $t('admin.users.users') }}</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('admin.users.col.user') }}</TableHead><TableHead scope="col">{{ $t('admin.users.col.role') }}</TableHead><TableHead scope="col">{{ $t('admin.users.col.upstreams') }}</TableHead><TableHead scope="col">{{ $t('admin.users.col.lastActivity') }}</TableHead><TableHead scope="col">{{ $t('admin.users.col.stdioAllowed') }}</TableHead><TableHead scope="col"><span class="sr-only">{{ $t('admin.users.col.actions') }}</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="u in users.data.value.items" :key="u.id">
          <TableCell><div class="font-medium">{{ u.name }}<span v-if="u.banned" class="ml-2 rounded-full bg-err-bg px-2 py-0.5 text-xs text-destructive">{{ $t('admin.users.bannedBadge') }}</span></div><div class="text-xs text-muted-foreground">{{ u.email }}</div></TableCell>
          <TableCell>{{ roleLabel(u.role) }}</TableCell>
          <TableCell class="tnum">{{ u.upstreamCount }} / {{ u.limits.maxUpstreams }}</TableCell>
          <TableCell><RelativeTime :value="u.lastActivityAt" :empty="$t('admin.users.noActivity')" /></TableCell>
          <TableCell><Checkbox :model-value="u.stdioAllowed" :aria-label="$t('admin.users.allowStdioAria', { name: u.name })" class="size-5" @update:model-value="(v) => setStdio(u, v)" /></TableCell>
          <TableCell class="text-right">
            <Button variant="ghost" :aria-label="$t('admin.users.limitsAria', { name: u.name })" @click="openLimits(u)">{{ $t('admin.users.limitsBtn') }}</Button>
            <Button v-if="u.banned" variant="outline" :aria-label="$t('admin.users.unbanAria', { name: u.name })" @click="unban(u)">{{ $t('admin.users.unban') }}</Button>
            <Button v-else variant="outline" :disabled="protectedUser(u)" :aria-label="$t('admin.users.banAria', { name: u.name })" @click="pending = { kind: 'ban', user: u }">{{ $t('admin.users.ban') }}</Button>
            <Button variant="destructive-outline" :disabled="protectedUser(u)" :aria-label="$t('admin.users.deleteAria', { name: u.name })" @click="pending = { kind: 'delete', user: u }">{{ $t('admin.users.delete') }}</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <DataSection :title="$t('admin.users.openInvites')" min-width="640px">
    <template #actions><Button @click="invDialog = true">{{ $t('admin.users.createInviteBtn') }}</Button></template>
    <LoadingRows v-if="invites.status.value === 'pending' && !invites.data.value" :rows="2" />
    <EmptyState v-else-if="!invites.data.value?.items.length" :title="$t('admin.users.noInvites')" />
    <Table v-else>
      <caption class="sr-only">{{ $t('admin.users.invitesCaption') }}</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">{{ $t('admin.users.col.boundTo') }}</TableHead><TableHead scope="col">{{ $t('admin.users.col.status') }}</TableHead><TableHead scope="col">{{ $t('admin.users.col.expires') }}</TableHead><TableHead scope="col"><span class="sr-only">{{ $t('admin.users.col.actions') }}</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="i in invites.data.value.items" :key="i.id">
          <TableCell>{{ i.email ?? $t('admin.users.noEmail') }}</TableCell>
          <TableCell>{{ inviteStatusLabel(i.status) }}</TableCell>
          <TableCell>{{ formatDate(i.expiresAt) }}</TableCell>
          <TableCell class="text-right"><Button v-if="i.status === 'open'" variant="destructive-outline" :aria-label="$t('admin.users.revokeInviteAria', { email: i.email ?? '' })" @click="revokeInvite(i.id)">{{ $t('admin.users.revoke') }}</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <Dialog v-model:open="invDialog">
    <DialogContent>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="createInvite">
        <DialogHeader><DialogTitle>{{ $t('admin.users.inviteDialogTitle') }}</DialogTitle><DialogDescription>{{ $t('admin.users.inviteDialogDesc') }}</DialogDescription></DialogHeader>
        <p v-if="inv.formError.value" role="alert" class="text-sm text-destructive">{{ inv.formError.value }}</p>
        <FormRow id="inv-email" :label="$t('admin.users.email')" optional :description="$t('admin.users.emailDesc')" :error="inv.form.errors.value.email">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="invEmail" type="email" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <div v-if="pub?.mail" class="flex items-center gap-2">
          <Checkbox id="inv-send" v-model="sendByMail" class="size-5" :disabled="!invEmail" />
          <label for="inv-send" class="text-sm" :class="invEmail ? '' : 'text-muted-foreground'">{{ $t('admin.users.sendByMail') }}<span v-if="!invEmail" class="text-xs">{{ $t('admin.users.emailNeeded') }}</span></label>
        </div>
        <DialogFooter><Button type="button" variant="outline" @click="invDialog = false">{{ $t('admin.users.cancel') }}</Button><LoadingButton :busy="inv.busy.value">{{ $t('admin.users.create') }}</LoadingButton></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog :open="!!limitsFor" @update:open="(v) => !v && (limitsFor = null)">
    <DialogContent>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="saveLimits">
        <DialogHeader><DialogTitle>{{ $t('admin.users.limitsDialogTitle', { name: limitsFor?.name }) }}</DialogTitle><DialogDescription>{{ $t('admin.users.limitsDialogDesc', { upstreams: users.data.value?.defaults.maxUpstreams, calls: users.data.value?.defaults.callsPerMin }) }}</DialogDescription></DialogHeader>
        <p v-if="lim.formError.value" role="alert" class="text-sm text-destructive">{{ lim.formError.value }}</p>
        <FormRow v-for="[k, l] in LIM_FIELDS" :id="`lim-${k}`" :key="k" :label="$t(l)" :error="(lim.form.errors.value as Record<string, string>)[k]">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="(lim.form.values as Record<string, number>)[k]" type="number" min="1" inputmode="numeric" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <DialogFooter><Button type="button" variant="outline" @click="limitsFor = null">{{ $t('admin.users.cancel') }}</Button><LoadingButton :busy="lim.busy.value">{{ $t('admin.users.save') }}</LoadingButton></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <ConfirmDialog
    :open="!!pending" :title="pending?.kind === 'ban' ? $t('admin.users.banTitle') : deleteStep === 1 ? $t('admin.users.deleteTitle') : $t('admin.users.deleteFinalTitle')"
    :confirm-label="pending?.kind === 'ban' ? $t('admin.users.banConfirm') : deleteStep === 1 ? $t('admin.users.next') : $t('admin.users.deleteFinal')" @update:open="(v) => { if (!v) { pending = null; deleteStep = 1 } }" @confirm="runPending"
  >
    <template v-if="pending?.kind === 'ban'">{{ $t('admin.users.banBody', { name: pending.user.name }) }}</template>
    <template v-else>
      <p>{{ $t('admin.users.deleteIntro', { name: pending?.user.name }) }}</p>
      <ul class="mt-1 list-disc pl-5"><li>{{ $t('admin.users.deleteUpstreams', { n: pending?.user.upstreamCount }) }}</li><li>{{ $t('admin.users.deleteTokens') }}</li><li>{{ $t('admin.users.deleteStdio') }}</li></ul>
      <p v-if="deleteStep === 2" class="mt-2 font-semibold">{{ $t('admin.users.irreversible') }}</p>
    </template>
  </ConfirmDialog>
</template>
