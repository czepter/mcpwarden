<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import { authApi, publicApi } from '~/api'
import FormRow from '~/components/common/FormRow.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Input } from '~/components/ui/input'
import { useZodForm } from '~/lib/useZodForm'
import { forgotSchema } from '~/lib/zod-schemas'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useHead({ title: () => t('auth.forgot.docTitle'), meta: [{ name: 'robots', content: 'noindex' }] })
const { data: pub, status } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false, registrationOpen: false })), { server: false })
const { form, formError, busy, submit } = useZodForm(forgotSchema, { email: '' })
const [email] = form.defineField('email')
const sent = ref(false)
// The response is always the same: the page does not reveal whether an account exists for the address.
const onSubmit = submit(async (v) => {
  await authApi.requestPasswordReset(v.email)
  sent.value = true
}, ['email'])
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <h1 class="mb-1 text-lg font-semibold">{{ $t('auth.forgot.title') }}</h1>
    <LoadingRows v-if="status === 'pending' || !pub" :rows="2" />
    <template v-else-if="!pub.mail">
      <p class="text-[13px] text-muted-foreground">{{ $t('auth.forgot.noMail') }}</p>
    </template>
    <template v-else-if="sent">
      <Alert role="status"><AlertDescription>{{ $t('auth.forgot.sent') }}</AlertDescription></Alert>
    </template>
    <template v-else>
      <p class="mb-4 text-[13px] text-muted-foreground">{{ $t('auth.forgot.intro') }}</p>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
        <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>
        <FormRow id="email" :label="$t('auth.forgot.email')" :error="form.errors.value.email">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="email" type="email" autocomplete="username" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <LoadingButton :busy="busy">{{ $t('auth.forgot.submit') }}</LoadingButton>
      </form>
    </template>
    <p class="mt-4 text-[13px] text-muted-foreground"><NuxtLink to="/login" class="text-primary underline">{{ $t('auth.forgot.back') }}</NuxtLink></p>
  </div>
</template>
