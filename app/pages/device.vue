<script setup lang="ts">
import { deviceApi } from '~/api'
import { ApiError } from '~/api/http'
import LoadingButton from '~/components/common/LoadingButton.vue'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { scopeLabel } from '~/lib/labels'

// Device grant (RFC 8628) for headless sessions: the user types the code the terminal shows, then approves or denies.
// The API answers `client_id`/`scope` only to the user the code is bound to; looking a code up binds it to the current user.
definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useHead({ title: () => t('auth.device.docTitle'), meta: [{ name: 'robots', content: 'noindex' }] })
const route = useRoute()
const { user } = useSessionUser()

// Codes use the alphabet without 0/O/1/I; input is shown as XXXX-XXXX.
const clean = (v: string) => v.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8)
const pretty = (v: string) => (v.length > 4 ? `${v.slice(0, 4)}-${v.slice(4)}` : v)
const initial = typeof route.query.user_code === 'string' ? clean(route.query.user_code) : ''
const input = ref(pretty(initial))
const code = ref('')
const review = ref<Awaited<ReturnType<typeof deviceApi.lookup>> | null>(null)
const outcome = ref<'approved' | 'denied' | null>(null)
const failure = ref('')
const busy = ref(false)

const errorText = (e: unknown) => {
  if (e instanceof ApiError) {
    if (e.code === 'expired_token') return t('auth.device.expired')
    if (e.code === 'invalid_request') return t('auth.device.invalid')
    if (e.code === 'access_denied') return t('auth.device.notYours')
    return e.message
  }
  return t('auth.device.unexpectedError')
}

async function lookup() {
  const c = clean(input.value)
  if (c.length !== 8) { failure.value = t('auth.device.invalid'); return }
  busy.value = true; failure.value = ''
  try {
    const r = await deviceApi.lookup(c)
    code.value = c
    review.value = r
    // A code that is not (or no longer) ours or not pending shows no request details: do not offer a decision.
    if (r.status !== 'pending' || !r.client_id) failure.value = r.status === 'pending' ? t('auth.device.notYours') : t('auth.device.processed')
  } catch (e) { failure.value = errorText(e) } finally { busy.value = false }
}

async function decide(approve: boolean) {
  busy.value = true; failure.value = ''
  try {
    await (approve ? deviceApi.approve(code.value) : deviceApi.deny(code.value))
    outcome.value = approve ? 'approved' : 'denied'
  } catch (e) { failure.value = errorText(e) } finally { busy.value = false }
}

const decidable = computed(() => review.value?.status === 'pending' && !!review.value.client_id && !outcome.value)
const scopes = computed(() => (review.value?.scope ?? '').split(/\s+/).filter(s => s === 'mcp:tools'))
onMounted(() => { if (initial.length === 8) void lookup() })
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <p v-if="outcome" role="status" class="text-[13px]">{{ outcome === 'approved' ? $t('auth.device.approved') : $t('auth.device.denied') }}</p>
    <div v-else class="flex flex-col gap-5">
      <div>
        <h1 class="text-lg font-semibold">{{ $t('auth.device.title') }}</h1>
        <div class="text-[13px] text-muted-foreground">{{ $t('auth.device.signedInAs', { email: user?.email }) }}</div>
      </div>

      <form v-if="!decidable" class="flex flex-col gap-3" novalidate @submit.prevent="lookup">
        <p class="text-[13px] text-muted-foreground">{{ $t('auth.device.intro') }}</p>
        <label for="user-code" class="text-sm font-medium">{{ $t('auth.device.codeLabel') }}</label>
        <Input
          id="user-code" v-model="input" class="mono text-center text-lg tracking-[0.3em]" inputmode="text" autocomplete="off" autocapitalize="characters"
          spellcheck="false" maxlength="9" placeholder="XXXX-XXXX" @update:model-value="(v: string | number) => (input = pretty(clean(String(v))))"
        />
        <Alert v-if="failure" variant="destructive" role="alert"><AlertDescription>{{ failure }}</AlertDescription></Alert>
        <div class="flex justify-end"><LoadingButton :loading="busy" type="submit">{{ $t('auth.device.continue') }}</LoadingButton></div>
      </form>

      <template v-else>
        <Alert role="alert" class="border-warn-border bg-warn-bg text-warn-fg text-[13px]">
          <div class="font-semibold">{{ $t('auth.device.onlyIfYours') }}</div>
          <p class="mt-1">{{ $t('auth.device.codeMustMatch') }}</p>
          <p class="mono mt-2 text-center text-lg tracking-[0.3em]">{{ pretty(code) }}</p>
        </Alert>
        <div class="text-[13px]">
          <i18n-t keypath="auth.device.wantsAccess" tag="span"><template #client><strong>mcpwarden CLI</strong></template></i18n-t>
        </div>
        <section :aria-label="$t('auth.consent.permissions')" class="flex flex-col gap-2">
          <h2 class="text-sm font-semibold">{{ $t('auth.device.clientMay') }}</h2>
          <ul class="flex flex-col gap-2">
            <li v-for="s in scopes" :key="s" class="flex flex-col gap-0.5 rounded-sm border bg-card px-3 py-2.5">
              <div class="flex items-center justify-between gap-2"><span class="font-medium">{{ scopeLabel(s) }}</span><code class="text-xs text-secondary-foreground">{{ s }}</code></div>
              <div class="text-[13px] text-secondary-foreground">{{ $t('auth.consent.useTools') }}</div>
            </li>
          </ul>
          <p class="text-xs text-muted-foreground">{{ $t('auth.consent.stayLoggedIn') }}</p>
        </section>
        <p v-if="failure" role="alert" class="text-sm text-destructive">{{ failure }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="decide(false)">{{ $t('auth.consent.deny') }}</Button>
          <Button :disabled="busy" @click="decide(true)">{{ $t('auth.consent.allow') }}</Button>
        </div>
        <p class="text-xs text-muted-foreground">{{ $t('auth.consent.revokeHint') }}</p>
      </template>
    </div>
  </div>
</template>
