<script setup lang="ts">
import { publicApi } from '~/api'
import SignUpForm from '~/components/access/SignUpForm.vue'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useHead({ title: () => t('auth.register.docTitle') })
const { load } = useSessionUser()
const { data: pub } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false, registrationOpen: false })), { server: false })
async function done() { await load(true); await navigateTo('/') }
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <h1 class="mb-1 text-lg font-semibold">{{ $t('auth.register.title') }}</h1>
    <p class="mb-4 text-[13px] text-muted-foreground">{{ pub?.registrationOpen ? $t('auth.register.firstAdmin') : $t('auth.register.viaInvite') }}</p>
    <SignUpForm @done="done" />
    <p class="mt-4 text-[13px] text-muted-foreground">{{ $t('auth.register.haveAccount') }} <NuxtLink to="/login" class="text-primary underline">{{ $t('auth.register.signIn') }}</NuxtLink></p>
  </div>
</template>
