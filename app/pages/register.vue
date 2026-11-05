<script setup lang="ts">
import { publicApi } from '~/api'
import SignUpForm from '~/components/access/SignUpForm.vue'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Registrieren · mcpwarden' })
const { load } = useSessionUser()
const { data: pub } = useAsyncData('public-config', () => publicApi.config().catch(() => ({ mail: false, registrationOpen: false })), { server: false })
async function done() { await load(true); await navigateTo('/') }
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <h1 class="mb-1 text-lg font-semibold">Registrieren</h1>
    <p class="mb-4 text-[13px] text-muted-foreground">{{ pub?.registrationOpen ? 'Das erste Konto wird Admin. Danach ist die Registrierung nur mit Einladung möglich.' : 'Neue Konten entstehen über einen Einladungslink. Öffne den Link, den dir ein Admin gegeben hat.' }}</p>
    <SignUpForm @done="done" />
    <p class="mt-4 text-[13px] text-muted-foreground">Schon ein Konto? <NuxtLink to="/login" class="text-primary underline">Anmelden</NuxtLink></p>
  </div>
</template>
