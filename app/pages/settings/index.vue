<script setup lang="ts">
import { authApi, meApi, publicApi } from '~/api'
import { toast } from 'vue-sonner'
import FormRow from '~/components/common/FormRow.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import SecretField from '~/components/common/SecretField.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import { useZodForm } from '~/lib/useZodForm'
import { nameSchema, passwordChangeSchema } from '~/lib/zod-schemas'

useHead({ title: 'Einstellungen · mcpwarden' })
const { user, load } = useSessionUser()
const nameForm = useZodForm(nameSchema, { name: user.value?.name ?? '' })
const [name] = nameForm.form.defineField('name')
const saveName = nameForm.submit(async (v) => { await authApi.updateName(v.name); await load(true); toast.success('Name gespeichert.') }, ['name'])

const pw = useZodForm(passwordChangeSchema, { current: '', next: '' })
const [current] = pw.form.defineField('current')
const [next] = pw.form.defineField('next')
const savePw = pw.submit(async (v) => {
  try { await authApi.changePassword(v.current, v.next) } finally { pw.form.setFieldValue('current', ''); pw.form.setFieldValue('next', '') }
  toast.success('Passwort geändert.')
}, ['currentPassword', 'newPassword'])

const { data: sessions, refresh } = useApi('sessions', authApi.listSessions)
async function revoke(token: string) { try { await authApi.revokeSession(token); await refresh() } catch { toast.error('Abmelden fehlgeschlagen.') } }
// Status mails (visible only if the server can send mail)
const { data: pub } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false })), { server: false })
const { data: meSettings, refresh: refreshMe } = useApi('me-settings', meApi.settings)
const notifyBusy = ref(false)
async function setNotify(v: boolean | 'indeterminate') {
  notifyBusy.value = true
  try { await meApi.patchSettings({ notifyStatusMail: v === true }); toast.success(v === true ? 'Benachrichtigungen eingeschaltet.' : 'Benachrichtigungen ausgeschaltet.') } catch { toast.error('Speichern fehlgeschlagen.') } finally { notifyBusy.value = false; await refreshMe() }
}
// Applies as long as the user has not toggled the bar themselves (cookie sidebar_state takes precedence, see layouts/default.vue).
const collapsedCookie = useCookie('sidebar_default_collapsed', { maxAge: 60 * 60 * 24 * 365 })
const collapsedDefault = computed({
  get: () => String(collapsedCookie.value) === 'true',
  set: (v: boolean) => { collapsedCookie.value = v ? 'true' : 'false' },
})
</script>

<template>
  <PageHeader title="Einstellungen" />
  <div class="flex max-w-[720px] flex-col gap-4">
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-profil">
      <h2 id="h-profil" class="mb-3 text-base font-semibold">Profil</h2>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="saveName">
        <p v-if="nameForm.formError.value" role="alert" class="text-sm text-destructive">{{ nameForm.formError.value }}</p>
        <FormRow id="p-name" label="Name" :error="nameForm.form.errors.value.name">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="name" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <div class="text-[13px] text-muted-foreground">E-Mail: {{ user?.email }}</div>
        <div><Button type="submit" :disabled="nameForm.busy.value">Speichern</Button></div>
      </form>
    </section>
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-pw">
      <h2 id="h-pw" class="mb-3 text-base font-semibold">Passwort</h2>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="savePw">
        <p v-if="pw.formError.value" role="alert" class="text-sm text-destructive">{{ pw.formError.value }}</p>
        <FormRow id="pw-cur" label="Aktuelles Passwort" :error="pw.form.errors.value.current">
          <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="current" :invalid="invalid" :describedby="describedby" /></template>
        </FormRow>
        <FormRow id="pw-new" label="Neues Passwort" description="Mindestens 12 Zeichen." :error="pw.form.errors.value.next">
          <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="next" :invalid="invalid" :describedby="describedby" /></template>
        </FormRow>
        <div><Button type="submit" variant="outline" :disabled="pw.busy.value">Passwort ändern</Button></div>
      </form>
    </section>
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-ses">
      <h2 id="h-ses" class="text-base font-semibold">Web-Sitzungen</h2>
      <p class="mb-3 text-[13px] text-muted-foreground">Browser, in denen du in der Web-UI angemeldet bist. Verbundene Coding-Tools findest du unter <NuxtLink to="/settings/connections" class="font-medium text-primary underline-offset-4 hover:underline">Clients</NuxtLink>.</p>
      <ul class="flex flex-col divide-y">
        <li v-for="s in sessions ?? []" :key="s.id" class="flex min-h-11 items-center justify-between gap-3 py-2">
          <div><div class="font-medium">{{ s.userAgent ?? 'Unbekanntes Gerät' }}<span v-if="s.current" class="text-muted-foreground"> (diese Sitzung)</span></div><div class="text-xs text-muted-foreground">Seit <RelativeTime :value="s.createdAt" /></div></div>
          <Button v-if="!s.current" variant="outline" :aria-label="`Sitzung ${s.userAgent ?? ''} abmelden`" @click="revoke(s.token)">Abmelden</Button>
        </li>
      </ul>
    </section>
    <section v-if="pub?.mail" class="rounded-lg border bg-card p-5" aria-labelledby="h-ben">
      <h2 id="h-ben" class="mb-3 text-base font-semibold">Benachrichtigungen</h2>
      <div class="flex items-center gap-3">
        <Switch id="notify-status" :model-value="meSettings?.notifyStatusMail ?? true" :disabled="notifyBusy || !meSettings" @update:model-value="setNotify" />
        <label for="notify-status">E-Mail bei Statuswechsel meiner Upstreams</label>
      </div>
      <p class="mt-2 text-[13px] text-muted-foreground">Wir schreiben dir, wenn ein Upstream nicht mehr erreichbar ist oder die Anmeldung ablehnt, und einmal, wenn er wieder läuft. Höchstens eine Mail je Upstream und Zustand pro Zeitfenster (Standard: eine Stunde).</p>
    </section>
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-dar">
      <h2 id="h-dar" class="mb-3 text-base font-semibold">Darstellung</h2>
      <div class="flex items-center gap-3">
        <Switch id="collapsed-default" v-model="collapsedDefault" />
        <label for="collapsed-default">Seitenleiste standardmäßig eingeklappt</label>
      </div>
    </section>
  </div>
</template>
