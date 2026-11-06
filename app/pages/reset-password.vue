<script setup lang="ts">
import LoadingButton from '~/components/common/LoadingButton.vue'
import { authApi } from '~/api'
import { ApiError } from '~/api/http'
import FormRow from '~/components/common/FormRow.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Input } from '~/components/ui/input'
import { useZodForm } from '~/lib/useZodForm'
import { resetSchema } from '~/lib/zod-schemas'

definePageMeta({ layout: 'auth' })
// Token page: no referrer, do not index. The token is in the fragment (no access log) and is removed from the address bar after reading.
const { t } = useI18n()
useHead({ title: () => t('auth.reset.docTitle'), meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex' }] })
const route = useRoute()
const token = ref('')
const invalid = ref(false)
const ready = ref(false) // Only the browser sees the fragment: render only after mounting (no hydration mismatch).
function readToken(h: string) {
  const t = new URLSearchParams(h.replace(/^#/, '')).get('token')
  if (!t) return
  token.value = t
  invalid.value = false
  history.replaceState(history.state, '', route.path)
}
onMounted(() => { readToken(route.hash); ready.value = true })
// Also re-read on hash navigation in the same tab (new link pasted).
watch(() => route.hash, readToken)

const { form, formError, busy, submit } = useZodForm(resetSchema, { password: '', confirm: '' })
const [password] = form.defineField('password')
const [confirm] = form.defineField('confirm')
const onSubmit = submit(async (v) => {
  try { await authApi.resetPassword(token.value, v.password) } catch (e) {
    if (e instanceof ApiError && e.code === 'INVALID_TOKEN') { invalid.value = true; return }
    form.setFieldValue('password', ''); form.setFieldValue('confirm', '')
    if (e instanceof ApiError && e.code === 'PASSWORD_TOO_SHORT') { form.setFieldError('password', t('auth.reset.minLength')); return }
    throw e
  }
  token.value = ''
  await navigateTo({ path: '/login', query: { reset: '1' } })
}, ['password'])
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <template v-if="!ready" />
    <template v-else-if="!token || invalid">
      <h1 class="mb-2 text-lg font-semibold">{{ $t('auth.reset.invalidTitle') }}</h1>
      <p role="alert" class="text-[13px]">{{ $t('auth.reset.invalidText') }}</p>
      <p class="mt-2 text-[13px] text-muted-foreground"><NuxtLink to="/forgot-password" class="text-primary underline">{{ $t('auth.reset.requestNew') }}</NuxtLink></p>
    </template>
    <template v-else>
      <h1 class="mb-4 text-lg font-semibold">{{ $t('auth.reset.title') }}</h1>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="onSubmit">
        <Alert v-if="formError" variant="destructive" role="alert"><AlertDescription>{{ formError }}</AlertDescription></Alert>
        <FormRow id="password" :label="$t('auth.reset.newPassword')" :description="$t('auth.reset.minLength')" :error="form.errors.value.password">
          <template #default="{ id, invalid: bad, describedby }"><Input :id="id" v-model="password" type="password" autocomplete="new-password" :aria-invalid="bad || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <FormRow id="confirm" :label="$t('auth.reset.confirm')" :error="form.errors.value.confirm">
          <template #default="{ id, invalid: bad, describedby }"><Input :id="id" v-model="confirm" type="password" autocomplete="new-password" :aria-invalid="bad || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <LoadingButton :busy="busy">{{ $t('auth.reset.submit') }}</LoadingButton>
      </form>
    </template>
  </div>
</template>
