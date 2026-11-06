<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
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

const { t } = useI18n()
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
async function setNotify(v: boolean | 'indeterminate') {
  notifyBusy.value = true
  try { await meApi.patchSettings({ notifyStatusMail: v === true }); toast.success(v === true ? t('settings.index.notifyOn') : t('settings.index.notifyOff')) } catch { toast.error(t('settings.index.saveFailed')) } finally { notifyBusy.value = false; await refreshMe() }
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
  <div class="flex max-w-[720px] flex-col gap-4">
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-profil">
      <h2 id="h-profil" class="mb-3 text-base font-semibold">{{ $t('settings.index.profile') }}</h2>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="saveName">
        <p v-if="nameForm.formError.value" role="alert" class="text-sm text-destructive">{{ nameForm.formError.value }}</p>
        <FormRow id="p-name" :label="$t('settings.index.name')" :error="nameForm.form.errors.value.name">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="name" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <div class="text-[13px] text-muted-foreground">{{ $t('settings.index.email', { email: user?.email }) }}</div>
        <div><LoadingButton :busy="nameForm.busy.value">{{ $t('settings.index.save') }}</LoadingButton></div>
      </form>
    </section>
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-pw">
      <h2 id="h-pw" class="mb-3 text-base font-semibold">{{ $t('settings.index.password') }}</h2>
      <form class="flex flex-col gap-3" novalidate @submit.prevent="savePw">
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
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-ses">
      <h2 id="h-ses" class="text-base font-semibold">{{ $t('settings.index.sessions') }}</h2>
      <p class="mb-3 text-[13px] text-muted-foreground"><i18n-t keypath="settings.index.sessionsDesc" tag="span"><template #link><NuxtLink to="/settings/connections" class="font-medium text-primary underline-offset-4 hover:underline">{{ $t('settings.index.sessionsLink') }}</NuxtLink></template></i18n-t></p>
      <ul class="flex flex-col divide-y">
        <li v-for="s in sessions ?? []" :key="s.id" class="flex min-h-11 items-center justify-between gap-3 py-2">
          <div><div class="font-medium">{{ s.userAgent ?? $t('settings.index.unknownDevice') }}<span v-if="s.current" class="text-muted-foreground">{{ $t('settings.index.thisSession') }}</span></div><div class="text-xs text-muted-foreground">{{ $t('settings.index.since') }} <RelativeTime :value="s.createdAt" /></div></div>
          <Button v-if="!s.current" variant="outline" :aria-label="$t('settings.index.signOutLabel', { agent: s.userAgent ?? '' })" @click="revoke(s.token)">{{ $t('settings.index.signOut') }}</Button>
        </li>
      </ul>
    </section>
    <section v-if="pub?.mail" class="rounded-lg border bg-card p-5" aria-labelledby="h-ben">
      <h2 id="h-ben" class="mb-3 text-base font-semibold">{{ $t('settings.index.notifications') }}</h2>
      <div class="flex items-center gap-3">
        <Switch id="notify-status" :model-value="meSettings?.notifyStatusMail ?? true" :disabled="notifyBusy || !meSettings" @update:model-value="setNotify" />
        <label for="notify-status">{{ $t('settings.index.notifyLabel') }}</label>
      </div>
      <p class="mt-2 text-[13px] text-muted-foreground">{{ $t('settings.index.notifyDesc') }}</p>
    </section>
    <section class="rounded-lg border bg-card p-5" aria-labelledby="h-dar">
      <h2 id="h-dar" class="mb-3 text-base font-semibold">{{ $t('settings.index.appearance') }}</h2>
      <div class="flex items-center gap-3">
        <Switch id="collapsed-default" v-model="collapsedDefault" />
        <label for="collapsed-default">{{ $t('settings.index.collapsedDefault') }}</label>
      </div>
    </section>
  </div>
</template>
