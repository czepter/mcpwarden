<script setup lang="ts">
import { inviteApi } from '~/api'
import SignUpForm from '~/components/access/SignUpForm.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import { formatDate } from '~/lib/format'

definePageMeta({ layout: 'auth' })
// Link page: no referrer, do not index (section 10 rule 6).
const { t } = useI18n()
useHead({ title: () => t('auth.invite.docTitle'), meta: [{ name: 'referrer', content: 'no-referrer' }, { name: 'robots', content: 'noindex' }] })
const route = useRoute()
const token = String(route.params.token)
const { data, status } = useAsyncData(`invite-${token.length}`, () => inviteApi.check(token), { server: false })
const { load } = useSessionUser()
function reasonText(reason: string) {
  return t(`auth.invite.reasons.${['expired', 'used', 'revoked'].includes(reason) ? reason : 'unknown'}`)
}
async function done() { await load(true); await navigateTo('/') }
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <LoadingRows v-if="status === 'pending' || !data" :rows="3" />
    <template v-else-if="data.valid">
      <h1 class="mb-1 text-lg font-semibold">{{ $t('auth.invite.title') }}</h1>
      <p class="mb-4 text-[13px] text-muted-foreground">{{ $t('auth.invite.validUntil', { date: formatDate(data.expiresAt) }) }}</p>
      <SignUpForm :invite-token="token" :locked-email="data.email" @done="done" />
    </template>
    <template v-else>
      <h1 class="mb-2 text-lg font-semibold">{{ $t('auth.invite.unusableTitle') }}</h1>
      <p role="alert" class="text-[13px]">{{ reasonText(data.reason) }}</p>
      <p class="mt-2 text-[13px] text-muted-foreground">{{ $t('auth.invite.contactAdmin') }}</p>
    </template>
  </div>
</template>
