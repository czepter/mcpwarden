<script setup lang="ts">
import { authApi } from '~/api'
import FormRow from '~/components/common/FormRow.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useZodForm } from '~/lib/useZodForm'
import { loginSchema } from '~/lib/zod-schemas'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Anmelden · mcpwarden' })
const route = useRoute()
const { load } = useSessionUser()
const { form, formError, busy, submit } = useZodForm(loginSchema, { email: '', password: '' })
const [email] = form.defineField('email')
const [password] = form.defineField('password')

const onSubmit = submit(async (v) => {
  try { await authApi.signIn(v.email, v.password) } catch (e) { form.setFieldValue('password', ''); throw e }
  await load(true)
  // OAuth-Fortsetzung: die vom Plugin signierte Query bleibt unveraendert (Pfad unverifiziert, 0b R14).
  if (route.query.sig) { await navigateTo(`/consent?${new URLSearchParams(route.query as Record<string, string>).toString()}`); return }
  const r = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') && !route.query.redirect.startsWith('//') ? route.query.redirect : '/'
  await navigateTo(r)
})
const { data: reg } = useAsyncData('reg-open', () => authApi.registrationOpen().catch(() => ({ open: false })), { server: false })
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <h1 class="mb-4 text-lg font-semibold">Anmelden</h1>
    <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
      <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>
      <FormRow id="email" label="E-Mail" :error="form.errors.value.email">
        <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="email" type="email" autocomplete="username" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
      </FormRow>
      <FormRow id="password" label="Passwort" :error="form.errors.value.password">
        <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="password" type="password" autocomplete="current-password" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
      </FormRow>
      <Button type="submit" :disabled="busy" :aria-busy="busy"><Spinner v-if="busy" />Anmelden</Button>
    </form>
    <p class="mt-4 text-[13px] text-muted-foreground">
      <template v-if="reg?.open">Noch kein Konto? <NuxtLink to="/register" class="text-primary underline">Registrieren</NuxtLink></template>
      <template v-else>Neue Konten gibt es nur mit Einladung. Frag einen Admin nach einem Einladungslink.</template>
    </p>
  </div>
</template>
