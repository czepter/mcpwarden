<script setup lang="ts">
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
useHead({ title: 'Admin: Clients (DCR) · mcpwarden' })
const policy = useApi('dcr-policy', adminApi.policy)
const allow = useApi('dcr-allow', adminApi.allowlist)
const clients = useApi('dcr-clients', adminApi.clients)
const MODES: Array<[DcrMode, string, string]> = [
  ['off', 'Aus', 'Neue Clients können sich nicht selbst registrieren.'],
  ['allowlist', 'Nur Allowlist', 'Nur Clients, die zur Allowlist passen, dürfen sich registrieren.'],
  ['open', 'Offen mit Warnung', 'Jeder Client darf sich registrieren; unbekannte werden beim Consent mit Warnung angezeigt.'],
]
async function setMode(m: unknown) { try { await adminApi.setPolicy(m as DcrMode); await policy.refresh(); toast.success('Modus gespeichert.') } catch { toast.error('Speichern fehlgeschlagen.') } }

const dialog = ref(false)
const f = useZodForm(allowlistSchema, { label: '', namePattern: '', redirects: '' })
const [label] = f.form.defineField('label')
const [namePattern] = f.form.defineField('namePattern')
const [redirects] = f.form.defineField('redirects')
const add = f.submit(async (v) => {
  await adminApi.addAllow({ label: v.label, namePattern: v.namePattern, redirectPatterns: v.redirects.split('\n').map(s => s.trim()).filter(Boolean) })
  dialog.value = false; f.form.resetForm(); await allow.refresh()
}, ['label', 'namePattern'])
async function removeAllow(id: string) { try { await adminApi.removeAllow(id); await allow.refresh() } catch { toast.error('Entfernen fehlgeschlagen.') } }
const revoke = ref<OAuthClientAdmin | null>(null)
async function doRevoke() {
  if (!revoke.value) return
  try { await adminApi.revokeClient(revoke.value.id); toast.success('Client widerrufen.'); await clients.refresh() } catch { toast.error('Widerrufen fehlgeschlagen.') }
  revoke.value = null
}
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : null)
</script>

<template>
  <PageHeader title="Admin" />
  <AdminTabs />
  <section class="rounded-lg border bg-card p-5" aria-labelledby="h-mode">
    <h2 id="h-mode" class="mb-1 text-base font-semibold">Dynamic Client Registration</h2>
    <p class="mb-3 text-[13px] text-muted-foreground">Die Allowlist ist Komfort und Warnlogik, kein Sicherheitsmerkmal.</p>
    <RadioGroup v-if="policy.data.value" :model-value="policy.data.value.mode" aria-label="Registrierungsmodus" class="gap-2" @update:model-value="setMode">
      <label v-for="[m, l, d] in MODES" :key="m" class="flex min-h-11 cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5" :class="policy.data.value.mode === m ? 'border-primary bg-primary-tint' : 'bg-card'">
        <RadioGroupItem :value="m" class="mt-0.5" /><span><span class="block font-medium">{{ l }}</span><span class="block text-[13px] text-secondary-foreground">{{ d }}</span></span>
      </label>
    </RadioGroup>
    <ErrorState v-else-if="policy.error.value" :error="policy.error.value" @retry="policy.refresh()" />
    <Alert v-if="policy.data.value?.mode === 'open'" class="mt-3 border-[#fcd34d] bg-[#fef3c7] text-[13px] text-[#78350f]">Im offenen Modus kann sich jeder Client registrieren. Prüfe unbekannte Clients beim Consent genau.</Alert>
  </section>

  <DataSection title="Allowlist" min-width="720px">
    <template #actions><Button @click="dialog = true">+ Eintrag</Button></template>
    <LoadingRows v-if="allow.status.value === 'pending' && !allow.data.value" :rows="3" />
    <EmptyState v-else-if="!allow.data.value?.items.length" title="Allowlist ist leer" />
    <Table v-else>
      <caption class="sr-only">Allowlist</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">Bezeichnung</TableHead><TableHead scope="col">Name-Muster</TableHead><TableHead scope="col">Redirect-Muster</TableHead><TableHead scope="col"><span class="sr-only">Aktionen</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="e in allow.data.value.items" :key="e.id">
          <TableCell class="font-medium">{{ e.label }}</TableCell><TableCell><code class="text-xs">{{ e.namePattern }}</code></TableCell>
          <TableCell><div v-for="r in e.redirectPatterns" :key="r"><code class="text-xs">{{ r }}</code></div></TableCell>
          <TableCell class="text-right"><Button variant="ghost" :aria-label="`Eintrag ${e.label} entfernen`" @click="removeAllow(e.id)">✕</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <DataSection title="Registrierte Clients" min-width="900px">
    <LoadingRows v-if="clients.status.value === 'pending' && !clients.data.value" />
    <ErrorState v-else-if="clients.error.value" :error="clients.error.value" @retry="clients.refresh()" />
    <EmptyState v-else-if="!clients.data.value?.items.length" title="Keine registrierten Clients" />
    <Table v-else>
      <caption class="sr-only">Registrierte Clients</caption>
      <TableHeader><TableRow class="bg-table-head"><TableHead scope="col">Name</TableHead><TableHead scope="col">Redirect-URIs</TableHead><TableHead scope="col">Erstellt</TableHead><TableHead scope="col">Zuletzt genutzt</TableHead><TableHead scope="col">Nutzer</TableHead><TableHead scope="col">Allowlist</TableHead><TableHead scope="col">Verfall</TableHead><TableHead scope="col"><span class="sr-only">Aktionen</span></TableHead></TableRow></TableHeader>
      <TableBody>
        <TableRow v-for="c in clients.data.value.items" :key="c.id">
          <TableCell class="font-medium">{{ c.name }}</TableCell>
          <TableCell><div v-for="u in c.redirectUris" :key="u"><code class="text-xs">{{ u }}</code></div></TableCell>
          <TableCell><RelativeTime :value="c.createdAt" /></TableCell><TableCell><RelativeTime :value="c.lastUsedAt" empty="nie" /></TableCell>
          <TableCell class="tnum">{{ c.userCount }}</TableCell><TableCell>{{ c.allowlisted ? 'In Allowlist' : 'Nicht in Allowlist' }}</TableCell>
          <TableCell>{{ c.expiresAt ? `in ${daysLeft(c.expiresAt)} Tagen` : '–' }}</TableCell>
          <TableCell class="text-right"><Button variant="ghost" class="text-destructive" :aria-label="`${c.name} widerrufen`" @click="revoke = c">Widerrufen</Button></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </DataSection>

  <Dialog v-model:open="dialog">
    <DialogContent>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="add">
        <DialogHeader><DialogTitle>Allowlist-Eintrag</DialogTitle><DialogDescription>Muster mit * als Platzhalter. Ein Redirect-Muster pro Zeile.</DialogDescription></DialogHeader>
        <p v-if="f.formError.value" role="alert" class="text-sm text-destructive">{{ f.formError.value }}</p>
        <FormRow id="al-label" label="Bezeichnung" :error="f.form.errors.value.label"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="label" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="al-name" label="Name-Muster" :error="f.form.errors.value.namePattern"><template #default="{ id, invalid, describedby }"><Input :id="id" v-model="namePattern" class="mono" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <FormRow id="al-redir" label="Redirect-Muster" :error="f.form.errors.value.redirects"><template #default="{ id, invalid, describedby }"><Textarea :id="id" v-model="redirects" rows="3" class="mono" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template></FormRow>
        <DialogFooter><Button type="button" variant="outline" @click="dialog = false">Abbrechen</Button><Button type="submit" :disabled="f.busy.value">Hinzufügen</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
  <ConfirmDialog :open="!!revoke" title="Client widerrufen?" confirm-label="Widerrufen" @update:open="(v) => !v && (revoke = null)" @confirm="doRevoke">
    „{{ revoke?.name }}“ wird samt Zustimmungen und Tokens gelöscht. Nutzer verlieren den Zugriff.
  </ConfirmDialog>
</template>
