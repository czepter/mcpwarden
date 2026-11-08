<script setup lang="ts">
import { ref, watch } from 'vue'
import { meApi } from '~/api'
import { ApiError } from '~/api/http'
import FormRow from '~/components/common/FormRow.vue'
import LoadingButton from '~/components/common/LoadingButton.vue'
import SecretField from '~/components/common/SecretField.vue'
import { Button } from '~/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'

// Account erasure: current password and the literal e-mail address; the backend repeats both checks and refuses the last admin.
const props = defineProps<{ open: boolean, email: string }>()
const emit = defineEmits<{ 'update:open': [v: boolean], 'deleted': [] }>()
const { t } = useI18n()
const password = ref('')
const confirmEmail = ref('')
const busy = ref(false)
const errors = ref<{ password?: string, email?: string, form?: string }>({})
watch(() => props.open, (o) => { if (o) { password.value = ''; confirmEmail.value = ''; errors.value = {}; busy.value = false } })

const matches = computed(() => confirmEmail.value.trim().toLowerCase() === props.email.toLowerCase())
async function submit() {
  errors.value = {}
  if (!password.value) { errors.value = { password: t('settings.index.deletePassword') }; return }
  if (!matches.value) { errors.value = { email: t('settings.index.deleteEmailMismatch') }; return }
  busy.value = true
  try {
    await meApi.deleteAccount({ password: password.value, confirmEmail: confirmEmail.value })
    emit('update:open', false)
    emit('deleted')
  } catch (e) {
    const code = e instanceof ApiError ? e.code : ''
    if (code === 'invalid_password') errors.value = { password: t('settings.index.deleteWrongPassword') }
    else if (code === 'last_admin') errors.value = { form: t('settings.index.deleteLastAdmin') }
    else errors.value = { form: e instanceof ApiError && e.statusCode === 429 ? e.message : t('settings.index.deleteFailed') }
  } finally { password.value = ''; busy.value = false }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <form class="flex flex-col gap-4" novalidate data-testid="delete-account-form" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>{{ $t('settings.index.deleteDialogTitle') }}</DialogTitle>
          <DialogDescription>{{ $t('settings.index.deleteDialogBody') }}</DialogDescription>
        </DialogHeader>
        <p v-if="errors.form" role="alert" class="text-sm text-destructive">{{ errors.form }}</p>
        <FormRow id="del-email" :label="$t('settings.index.deleteConfirmEmail')" :description="$t('settings.index.deleteConfirmEmailHint', { email })" :error="errors.email">
          <template #default="{ id, invalid, describedby }"><Input :id="id" v-model="confirmEmail" type="email" autocomplete="off" :aria-invalid="invalid || undefined" :aria-describedby="describedby" /></template>
        </FormRow>
        <FormRow id="del-pw" :label="$t('settings.index.deletePassword')" :error="errors.password">
          <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="password" :invalid="invalid" :describedby="describedby" /></template>
        </FormRow>
        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">{{ $t('common.cancel') }}</Button>
          <LoadingButton variant="destructive" :busy="busy">{{ $t('settings.index.deleteSubmit') }}</LoadingButton>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
