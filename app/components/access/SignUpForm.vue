<script setup lang="ts">
import { authApi } from '~/api'
import FormRow from '~/components/common/FormRow.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { signUpSchema } from '~/lib/zod-schemas'
import { useZodForm } from '~/lib/useZodForm'

const props = defineProps<{ inviteToken?: string, lockedEmail?: string | null }>()
const emit = defineEmits<{ done: [] }>()
const { form, formError, busy, submit } = useZodForm(signUpSchema, { name: '', email: props.lockedEmail ?? '', password: '', confirm: '' })
const [name] = form.defineField('name')
const [email] = form.defineField('email')
const [password] = form.defineField('password')
const [confirm] = form.defineField('confirm')
const onSubmit = submit(async (v) => {
  try { await authApi.signUp({ name: v.name, email: v.email, password: v.password }, props.inviteToken) } catch (e) {
    form.setFieldValue('password', ''); form.setFieldValue('confirm', ''); throw e
  }
  emit('done')
}, ['name', 'email', 'password'])
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
    <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>
    <FormRow id="name" label="Name" :error="form.errors.value.name">
      <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="name" autocomplete="name" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
    </FormRow>
    <FormRow id="email" label="E-Mail" :error="form.errors.value.email" :description="lockedEmail ? 'Die Einladung gilt für diese Adresse.' : undefined">
      <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="email" type="email" autocomplete="email" :readonly="!!lockedEmail" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
    </FormRow>
    <FormRow id="password" label="Passwort" description="Mindestens 12 Zeichen." :error="form.errors.value.password">
      <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="password" type="password" autocomplete="new-password" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
    </FormRow>
    <FormRow id="confirm" label="Passwort bestätigen" :error="form.errors.value.confirm">
      <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="confirm" type="password" autocomplete="new-password" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
    </FormRow>
    <Button type="submit" :disabled="busy" :aria-busy="busy"><Spinner v-if="busy" />Konto anlegen</Button>
  </form>
</template>
