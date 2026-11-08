<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import { authApi, meApi, publicApi } from '~/api'
import { toast } from 'vue-sonner'
import FormRow from '~/components/common/FormRow.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import SecretField from '~/components/common/SecretField.vue'
import DeleteAccountDialog from '~/components/settings/DeleteAccountDialog.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'
import type { MeSettings, ThemePreference } from '#shared/api-types'
import { useZodForm } from '~/lib/useZodForm'
import { nameSchema, passwordChangeSchema } from '~/lib/zod-schemas'

const { t } = useI18n()
const THEMES = computed<Array<[string, string]>>(() => [['system', t('settings.index.themeSystem')], ['light', t('settings.index.themeLight')], ['dark', t('settings.index.themeDark')]])
useHead({ title: () => `${t('settings.index.title')} · mcpwarden` })
const { user, load } = useSessionUser()
const nameForm = useZodForm(nameSchema, { name: user.value?.name ?? '' })
const [name] = nameForm.form.defineField('name')
const saveName = nameForm.submit(async (v) => { await authApi.updateName(v.name); await load(true); toast.success(t('settings.index.nameSaved')) }, ['name'])

const pw = useZodForm(passwordChangeSchema, { current: '', next: '' })
const [current] = pw.form.defineField('current')
const [next] = pw.form.defineField('next')
const savePw = pw.submit(async (v) => {
  try { await authApi.changePassword(v.current, v.next) } finally { pw.form.setFieldValue('current', ''); pw.form.setFieldValue('next', '') }
  toast.success(t('settings.index.passwordChanged'))
}, ['currentPassword', 'newPassword'])

const { data: sessions, refresh } = useApi('sessions', authApi.listSessions)
async function revoke(token: string) { try { await authApi.revokeSession(token); await refresh() } catch { toast.error(t('settings.index.revokeFailed')) } }
// Status mails (visible only if the server can send mail)
const { data: pub } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false })), { server: false })
const { data: meSettings, refresh: refreshMe } = useApi('me-settings', meApi.settings)
const notifyBusy = ref(false)
type NotifyKey = 'notifyStatusMail' | 'notifyNewClient' | 'notifyWeekly'
// The three mail switches (status change, new client, weekly summary); titles and texts as in the mockup.
const NOTIFY_ROWS = computed<Array<{ key: NotifyKey, id: string, label: string, desc: string, dflt: boolean }>>(() => [
  { key: 'notifyStatusMail', id: 'notify-status', label: t('settings.index.notifyLabel'), desc: t('settings.index.notifyDesc'), dflt: true },
  { key: 'notifyNewClient', id: 'notify-new-client', label: t('settings.index.notifyNewClientLabel'), desc: t('settings.index.notifyNewClientDesc'), dflt: true },
  { key: 'notifyWeekly', id: 'notify-weekly', label: t('settings.index.notifyWeeklyLabel'), desc: t('settings.index.notifyWeeklyDesc'), dflt: false },
])
async function setNotify(key: NotifyKey, v: boolean | 'indeterminate') {
  notifyBusy.value = true
  try { await meApi.patchSettings({ [key]: v === true } as Partial<MeSettings>); toast.success(key === 'notifyStatusMail' ? (v === true ? t('settings.index.notifyOn') : t('settings.index.notifyOff')) : t('settings.index.notifySaved')) } catch { toast.error(t('settings.index.saveFailed')) } finally { notifyBusy.value = false; await refreshMe() }
}
// Appearance: applied at once (cookie + class), then stored on the server; a failed save rolls back.
const { theme, setTheme } = useTheme()
async function pickTheme(v: ThemePreference) {
  const before = theme.value
  if (v === before) return
  setTheme(v)
  try { await meApi.patchSettings({ theme: v }) } catch { setTheme(before); toast.error(t('settings.index.themeSaveFailed')) }
}
// Account deletion
const deleteOpen = ref(false)
async function afterDelete() {
  toast.success(t('settings.index.deleted'))
  clearNuxtState()
  await navigateTo('/login')
}
// Applies as long as the user has not toggled the bar themselves (cookie sidebar_state takes precedence, see layouts/default.vue).
const collapsedCookie = useCookie('sidebar_default_collapsed', { maxAge: 60 * 60 * 24 * 365 })
const collapsedDefault = computed({
  get: () => String(collapsedCookie.value) === 'true',
  set: (v: boolean) => { collapsedCookie.value = v ? 'true' : 'false' },
})
</script>

<template>
  <PageHeader :title="$t('settings.index.title')" />
  <div class="flex w-full max-w-[720px] flex-col gap-8">
    <section class="flex flex-col gap-4 rounded-lg border bg-card p-5" aria-labelledby="h-profil">
      <h2 id="h-profil" class="text-base font-semibold">{{ $t('settings.index.profile') }}</h2>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="saveName">
        <p v-if="nameForm.formError.value" role="alert" class="text-sm text-destructive">{{ nameForm.formError.value }}</p>
        <FormRow id="p-name" :label="$t('settings.index.name')" :error="nameForm.form.errors.value.name">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="name" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <FormRow id="p-mail" :label="$t('settings.index.emailLabel')" :description="$t('settings.index.emailHint')">
          <template #default="{ id, describedby }"><Input :id="id" type="email" :model-value="user?.email" readonly :aria-describedby="describedby" /></template>
        </FormRow>
        <div><LoadingButton :busy="nameForm.busy.value">{{ $t('settings.index.save') }}</LoadingButton></div>
      </form>
    </section>
    <section class="flex flex-col gap-4 rounded-lg border bg-card p-5" aria-labelledby="h-pw">
      <h2 id="h-pw" class="text-base font-semibold">{{ $t('settings.index.password') }}</h2>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="savePw">
        <p v-if="pw.formError.value" role="alert" class="text-sm text-destructive">{{ pw.formError.value }}</p>
        <FormRow id="pw-cur" :label="$t('settings.index.currentPassword')" :error="pw.form.errors.value.current">
          <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="current" :invalid="invalid" :describedby="describedby" /></template>
        </FormRow>
        <FormRow id="pw-new" :label="$t('settings.index.newPassword')" :description="$t('settings.index.newPasswordHint')" :error="pw.form.errors.value.next">
          <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="next" :invalid="invalid" :describedby="describedby" /></template>
        </FormRow>
        <div><LoadingButton variant="outline" :busy="pw.busy.value">{{ $t('settings.index.changePassword') }}</LoadingButton></div>
      </form>
    </section>
    <section class="flex flex-col gap-4 rounded-lg border bg-card p-5" aria-labelledby="h-ses">
      <h2 id="h-ses" class="text-base font-semibold">{{ $t('settings.index.sessions') }}</h2>
      <p class="-mt-3 text-[13px] text-muted-foreground"><i18n-t keypath="settings.index.sessionsDesc" tag="span"><template #link><NuxtLink to="/settings/connections" class="font-medium text-primary underline-offset-4 hover:underline">{{ $t('settings.index.sessionsLink') }}</NuxtLink></template></i18n-t></p>
      <ul class="flex flex-col divide-y">
        <li v-for="s in sessions ?? []" :key="s.id" class="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2">
          <div><div class="font-medium">{{ s.userAgent ?? $t('settings.index.unknownDevice') }}<span v-if="s.current" class="text-muted-foreground">{{ $t('settings.index.thisSession') }}</span></div><div class="text-xs text-muted-foreground">{{ $t('settings.index.since') }} <RelativeTime :value="s.createdAt" /></div></div>
          <Button v-if="!s.current" variant="outline" :aria-label="$t('settings.index.signOutLabel', { agent: s.userAgent ?? '' })" @click="revoke(s.token)">{{ $t('settings.index.signOut') }}</Button>
        </li>
      </ul>
    </section>
    <section class="flex flex-col gap-4 rounded-lg border bg-card p-5" aria-labelledby="h-dar">
      <h2 id="h-dar" class="text-base font-semibold">{{ $t('settings.index.appearance') }}</h2>
      <fieldset class="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
        <legend class="sr-only">{{ $t('settings.index.theme') }}</legend>
        <label v-for="[v, l] in THEMES" :key="v" class="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-sm border px-3" :class="v === theme ? 'border-primary bg-primary-tint' : 'bg-card'">
          <input type="radio" name="theme" :value="v" :checked="v === theme" class="size-[18px] accent-primary" @change="pickTheme(v as ThemePreference)">{{ l }}
        </label>
      </fieldset>
      <label class="flex min-h-11 cursor-pointer items-center gap-3" for="collapsed-default">
        <Switch id="collapsed-default" v-model="collapsedDefault" />
        {{ $t('settings.index.collapsedDefault') }}
      </label>
    </section>
    <section v-if="pub?.mail" class="flex flex-col gap-1 rounded-lg border bg-card p-5" aria-labelledby="h-ben">
      <h2 id="h-ben" class="mb-2 text-base font-semibold">{{ $t('settings.index.notifications') }}</h2>
      <label v-for="r in NOTIFY_ROWS" :key="r.key" class="flex min-h-[60px] cursor-pointer items-center justify-between gap-4 border-t py-2" :for="r.id">
        <span><span class="block font-medium">{{ r.label }}</span><span class="block text-[13px] text-secondary-foreground">{{ r.desc }}</span></span>
        <Switch :id="r.id" :aria-label="r.label" :model-value="meSettings?.[r.key] ?? r.dflt" :disabled="notifyBusy || !meSettings" @update:model-value="(v) => setNotify(r.key, v)" />
      </label>
    </section>
    <section class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--destructive-border)] bg-card p-5" aria-labelledby="h-del">
      <div class="flex-1 basis-80"><h2 id="h-del" class="text-base font-semibold text-destructive">{{ $t('settings.index.deleteAccount') }}</h2><p class="text-[13px] text-secondary-foreground">{{ $t('settings.index.deleteAccountDesc') }}</p></div>
      <Button variant="destructive-outline" data-testid="delete-account" @click="deleteOpen = true">{{ $t('settings.index.deleteAccount') }}</Button>
    </section>
  </div>
  <DeleteAccountDialog v-model:open="deleteOpen" :email="user?.email ?? ''" @deleted="afterDelete" />
</template>
