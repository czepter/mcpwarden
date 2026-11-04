<script setup lang="ts">
import { inviteApi } from '~/api'
import SignUpForm from '~/components/access/SignUpForm.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import { formatDate } from '~/lib/format'

definePageMeta({ layout: 'auth' })
// Link-Seite: kein Referrer, nicht indexieren (Abschnitt 10 Regel 6).
useHead({ title: 'Einladung · mcpwarden', meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex' }] })
const route = useRoute()
const token = String(route.params.token)
const { data, status } = useAsyncData(`invite-${token.length}`, () => inviteApi.check(token), { server: false })
const { load } = useSessionUser()
const REASONS: Record<string, string> = {
  expired: 'Diese Einladung ist abgelaufen (sie galt 7 Tage).',
  used: 'Diese Einladung wurde bereits verwendet.',
  revoked: 'Diese Einladung wurde widerrufen.',
  unknown: 'Diese Einladung ist ungültig.',
}
async function done() { await load(true); await navigateTo('/') }
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <LoadingRows v-if="status === 'pending' || !data" :rows="3" />
    <template v-else-if="data.valid">
      <h1 class="mb-1 text-lg font-semibold">Einladung annehmen</h1>
      <p class="mb-4 text-[13px] text-muted-foreground">Die Einladung gilt bis {{ formatDate(data.expiresAt) }}.</p>
      <SignUpForm :invite-token="token" :locked-email="data.email" @done="done" />
    </template>
    <template v-else>
      <h1 class="mb-2 text-lg font-semibold">Einladung nicht nutzbar</h1>
      <p role="alert" class="text-[13px]">{{ REASONS[data.reason] ?? REASONS.unknown }}</p>
      <p class="mt-2 text-[13px] text-muted-foreground">Bitte melde dich bei dem Admin, der dich eingeladen hat, und lass dir einen neuen Link geben.</p>
    </template>
  </div>
</template>
