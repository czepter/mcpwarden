<script setup lang="ts">
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
useHead({ title: 'Admin: Nutzer · mcpwarden' })
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
  if (r.mailQueued) toast.success('Einladung per E-Mail versendet. Der Link bleibt hier einmalig sichtbar.')
}, ['email'])
async function revokeInvite(id: string) { try { await adminApi.revokeInvite(id); await invites.refresh() } catch { toast.error('Widerrufen fehlgeschlagen.') } }

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
    toast.success(p.kind === 'ban' ? 'Nutzer gesperrt.' : 'Nutzer gelöscht.'); await users.refresh()
  } catch (e) { toast.error(e instanceof Error ? e.message : 'Aktion fehlgeschlagen.') }
  pending.value = null; deleteStep.value = 1
}
async function unban(u: AdminUser) { try { await adminApi.unban(u.id); await users.refresh() } catch { toast.error('Entsperren fehlgeschlagen.') } }
async function setStdio(u: AdminUser, v: boolean | 'indeterminate') {
  try { await adminApi.setLimits(u.id, { stdioAllowed: v === true }); await users.refresh() } catch { toast.error('Speichern fehlgeschlagen.') }
}

// Limits
const limitsFor = ref<AdminUser | null>(null)
const lim = useZodForm(limitsSchema, { maxUpstreams: 50, callsPerMin: 120, maxConnections: 20, stdioMaxProcs: 5, stdioIdleMin: 10 })
const LIM_FIELDS = [['maxUpstreams', 'Upstreams'], ['callsPerMin', 'Aufrufe pro Minute'], ['maxConnections', 'Verbindungen'], ['stdioMaxProcs', 'stdio-Prozesse'], ['stdioIdleMin', 'stdio-Leerlauf (min)']] as const
function openLimits(u: AdminUser) { limitsFor.value = u; lim.form.resetForm({ values: { ...u.limits } }) }
const saveLimits = lim.submit(async (v) => {
  await adminApi.setLimits(limitsFor.value!.id, v); limitsFor.value = null; toast.success('Limits gespeichert.'); await users.refresh()
}, LIM_FIELDS.map(f => f[0]))
</script>

<template>
  <PageHeader title="Admin" />
  <AdminTabs />
  <OneTimeSecret v-if="link" title="Einladungslink erzeugt (7 Tage gültig)" :value="link" @close="link = null" />

  <DataSection title="Nutzer" min-width="860px">
    <LoadingRows v-if="users.status.value === 'pending' && !users.data.value" />
    <ErrorState v-else-if="users.error.value" :error="users.error.value" @retry="users.refresh()" />
    <Table v-else-if="users.data.value">
      <caption class="sr-only">Nutzer</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">Nutzer</TableHead><TableHead scope="col">Rolle</TableHead><TableHead scope="col">Upstreams</TableHead><TableHead scope="col">Letzte Aktivität</TableHead><TableHead scope="col">stdio erlaubt</TableHead><TableHead scope="col"><span class="sr-only">Aktionen</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="u in users.data.value.items" :key="u.id">
          <TableCell><div class="font-medium">{{ u.name }}<span v-if="u.banned" class="ml-2 rounded-full bg-err-bg px-2 py-0.5 text-xs text-destructive">Gesperrt</span></div><div class="text-xs text-muted-foreground">{{ u.email }}</div></TableCell>
          <TableCell>{{ roleLabel(u.role) }}</TableCell>
          <TableCell class="tnum">{{ u.upstreamCount }} / {{ u.limits.maxUpstreams }}</TableCell>
          <TableCell><RelativeTime :value="u.lastActivityAt" empty="keine" /></TableCell>
          <TableCell><Checkbox :model-value="u.stdioAllowed" :aria-label="`stdio für ${u.name} erlauben`" class="size-5" @update:model-value="(v) => setStdio(u, v)" /></TableCell>
          <TableCell class="text-right">
            <Button variant="ghost" :aria-label="`Limits für ${u.name}`" @click="openLimits(u)">Limits</Button>
            <Button v-if="u.banned" variant="outline" :aria-label="`${u.name} entsperren`" @click="unban(u)">Entsperren</Button>
            <Button v-else variant="outline" :disabled="protectedUser(u)" :aria-label="`${u.name} sperren`" @click="pending = { kind: 'ban', user: u }">Sperren</Button>
            <Button variant="destructive-outline" :disabled="protectedUser(u)" :aria-label="`${u.name} löschen`" @click="pending = { kind: 'delete', user: u }">Löschen</Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <DataSection title="Offene Einladungen" min-width="640px">
    <template #actions><Button @click="invDialog = true">+ Einladung erzeugen</Button></template>
    <LoadingRows v-if="invites.status.value === 'pending' && !invites.data.value" :rows="2" />
    <EmptyState v-else-if="!invites.data.value?.items.length" title="Keine Einladungen" />
    <Table v-else>
      <caption class="sr-only">Einladungen</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">Gebunden an</TableHead><TableHead scope="col">Status</TableHead><TableHead scope="col">Läuft ab</TableHead><TableHead scope="col"><span class="sr-only">Aktionen</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="i in invites.data.value.items" :key="i.id">
          <TableCell>{{ i.email ?? 'Keine E-Mail' }}</TableCell>
          <TableCell>{{ inviteStatusLabel(i.status) }}</TableCell>
          <TableCell>{{ formatDate(i.expiresAt) }}</TableCell>
          <TableCell class="text-right"><Button v-if="i.status === 'open'" variant="destructive-outline" :aria-label="`Einladung ${i.email ?? ''} widerrufen`" @click="revokeInvite(i.id)">Widerrufen</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <Dialog v-model:open="invDialog">
    <DialogContent>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="createInvite">
        <DialogHeader><DialogTitle>Einladung erzeugen</DialogTitle><DialogDescription>Der Link ist 7 Tage gültig und wird nur einmal angezeigt.</DialogDescription></DialogHeader>
        <p v-if="inv.formError.value" role="alert" class="text-sm text-destructive">{{ inv.formError.value }}</p>
        <FormRow id="inv-email" label="E-Mail" optional description="Bindet die Einladung an diese Adresse." :error="inv.form.errors.value.email">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="invEmail" type="email" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <div v-if="pub?.mail" class="flex items-center gap-2">
          <Checkbox id="inv-send" v-model="sendByMail" class="size-5" :disabled="!invEmail" />
          <label for="inv-send" class="text-sm" :class="invEmail ? '' : 'text-muted-foreground'">Per E-Mail senden<span v-if="!invEmail" class="text-xs"> (E-Mail-Adresse nötig)</span></label>
        </div>
        <DialogFooter><Button type="button" variant="outline" @click="invDialog = false">Abbrechen</Button><Button type="submit" :disabled="inv.busy.value">Erzeugen</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <Dialog :open="!!limitsFor" @update:open="(v) => !v && (limitsFor = null)">
    <DialogContent>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="saveLimits">
        <DialogHeader><DialogTitle>Limits für {{ limitsFor?.name }}</DialogTitle><DialogDescription>Standardwerte: {{ users.data.value?.defaults.maxUpstreams }} Upstreams, {{ users.data.value?.defaults.callsPerMin }} Aufrufe pro Minute.</DialogDescription></DialogHeader>
        <p v-if="lim.formError.value" role="alert" class="text-sm text-destructive">{{ lim.formError.value }}</p>
        <FormRow v-for="[k, l] in LIM_FIELDS" :id="`lim-${k}`" :key="k" :label="l" :error="(lim.form.errors.value as Record<string, string>)[k]">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="(lim.form.values as Record<string, number>)[k]" type="number" min="1" inputmode="numeric" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <DialogFooter><Button type="button" variant="outline" @click="limitsFor = null">Abbrechen</Button><Button type="submit" :disabled="lim.busy.value">Speichern</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <ConfirmDialog
    :open="!!pending" :title="pending?.kind === 'ban' ? 'Nutzer sperren?' : deleteStep === 1 ? 'Nutzer löschen?' : 'Wirklich endgültig löschen?'"
    :confirm-label="pending?.kind === 'ban' ? 'Sperren' : deleteStep === 1 ? 'Weiter' : 'Endgültig löschen'" @update:open="(v) => { if (!v) { pending = null; deleteStep = 1 } }" @confirm="runPending"
  >
    <template v-if="pending?.kind === 'ban'">{{ pending.user.name }} wird abgemeldet; Tokens und Clients werden widerrufen. Du kannst entsperren.</template>
    <template v-else>
      <p>{{ pending?.user.name }} und alles, was dazugehört, wird gelöscht:</p>
      <ul class="mt-1 list-disc pl-5"><li>{{ pending?.user.upstreamCount }} Upstreams samt Secrets und Tool-Einstellungen</li><li>Tokens, Clients und Statistiken</li><li>laufende stdio-Prozesse und Dateien</li></ul>
      <p v-if="deleteStep === 2" class="mt-2 font-semibold">Das lässt sich nicht rückgängig machen.</p>
    </template>
  </ConfirmDialog>
</template>
