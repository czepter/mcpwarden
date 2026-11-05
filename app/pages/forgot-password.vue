<script setup lang="ts">
import { authApi, publicApi } from '~/api'
import FormRow from '~/components/common/FormRow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { useZodForm } from '~/lib/useZodForm'
import { forgotSchema } from '~/lib/zod-schemas'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Passwort vergessen · mcpwarden', meta: [{ name: 'robots', content: 'noindex' }] })
const { data: pub, status } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false, registrationOpen: false })), { server: false })
const { form, formError, busy, submit } = useZodForm(forgotSchema, { email: '' })
const [email] = form.defineField('email')
const sent = ref(false)
// Die Antwort ist immer dieselbe: die Seite verrät nicht, ob zur Adresse ein Konto existiert.
const onSubmit = submit(async (v) => {
  await authApi.requestPasswordReset(v.email)
  sent.value = true
}, ['email'])
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <h1 class="mb-1 text-lg font-semibold">Passwort vergessen</h1>
    <LoadingRows v-if="status === 'pending' || !pub" :rows="2" />
    <template v-else-if="!pub.mail">
      <p class="text-[13px] text-muted-foreground">Auf dieser Instanz ist der E-Mail-Versand nicht eingerichtet. Bitte einen Admin, dir ein neues Konto oder eine neue Einladung zu geben.</p>
    </template>
    <template v-else-if="sent">
      <Alert role="status"><AlertDescription>Wenn zu dieser Adresse ein Konto existiert, haben wir dir einen Link zum Zurücksetzen geschickt. Er ist 15 Minuten gültig.</AlertDescription></Alert>
    </template>
    <template v-else>
      <p class="mb-4 text-[13px] text-muted-foreground">Gib die E-Mail-Adresse deines Kontos ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegst.</p>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
        <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>
        <FormRow id="email" label="E-Mail" :error="form.errors.value.email">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="email" type="email" autocomplete="username" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <Button type="submit" :disabled="busy" :aria-busy="busy"><Spinner v-if="busy" />Link senden</Button>
      </form>
    </template>
    <p class="mt-4 text-[13px] text-muted-foreground"><NuxtLink to="/login" class="text-primary underline">Zurück zur Anmeldung</NuxtLink></p>
  </div>
</template>
