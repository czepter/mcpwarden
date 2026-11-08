<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import { authApi, publicApi } from '~/api'
import FormRow from '~/components/common/FormRow.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Input } from '~/components/ui/input'
import { useZodForm } from '~/lib/useZodForm'
import { loginSchema } from '~/lib/zod-schemas'

definePageMeta({ layout: 'auth', pageTransition: false })
const { t } = useI18n()
useHead({ title: () => t('auth.login.docTitle') })
const route = useRoute()
const { load } = useSessionUser()
const { form, formError, busy, submit } = useZodForm(loginSchema, { email: '', password: '' })
const [email] = form.defineField('email')
const [password] = form.defineField('password')

const onSubmit = submit(async (v) => {
  try { await authApi.signIn(v.email, v.password) } catch (e) { form.setFieldValue('password', ''); throw e }
  await load(true)
  // OAuth continuation: the query signed by the plugin stays unchanged (verified against the real backend: tests/helpers/oauth-client.ts).
  if (route.query.sig) { await navigateTo(`/consent?${new URLSearchParams(route.query as Record<string, string>).toString()}`); return }
  const r = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//') ? route.query.redirect : '/'
  await navigateTo(r)
})
const { data: pub } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false, registrationOpen: false })), { server: false })
// No user exists yet: the first visitor registers (and becomes admin) instead of seeing a login form nobody can use.
// A client-side navigation from here left the login form on screen under the /register URL (reproducible on the unchanged baseline), so this is a full navigation.
watch(() => pub.value?.registrationOpen, (open) => { if (open && !route.query.sig) void navigateTo('/register', { replace: true, external: true }) }, { immediate: true })
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <h1 class="mb-4 text-lg font-semibold">{{ $t('auth.login.title') }}</h1>
    <Alert v-if="route.query.reset" class="mb-4" role="status"><AlertDescription>{{ $t('auth.login.resetDone') }}</AlertDescription></Alert>
    <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
      <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>
      <FormRow id="email" :label="$t('auth.login.email')" :error="form.errors.value.email">
        <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="email" type="email" autocomplete="username" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
      </FormRow>
      <FormRow id="password" :label="$t('auth.login.password')" :error="form.errors.value.password">
        <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="password" type="password" autocomplete="current-password" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
      </FormRow>
      <LoadingButton :busy="busy">{{ $t('auth.login.submit') }}</LoadingButton>
      <NuxtLink v-if="pub?.mail" to="/forgot-password" class="text-[13px] text-primary underline">{{ $t('auth.login.forgot') }}</NuxtLink>
    </form>
    <p class="mt-4 text-[13px] text-muted-foreground">
      <template v-if="pub?.registrationOpen">{{ $t('auth.login.noAccount') }} <NuxtLink to="/register" class="text-primary underline">{{ $t('auth.login.register') }}</NuxtLink></template>
      <template v-else>{{ $t('auth.login.inviteOnly') }}</template>
    </p>
  </div>
</template>
