<script setup lang="ts">
import { oauthApi } from '~/api'
import { ApiError } from '~/api/http'
import ErrorState from '~/components/common/ErrorState.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import { Alert } from '~/components/ui/alert'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import { Switch } from '~/components/ui/switch'
import { FEATURES } from '~/lib/features'
import { scopeLabel } from '~/lib/labels'

definePageMeta({ layout: 'auth' })
const { t } = useI18n()
useHead({ title: () => t('auth.consent.docTitle'), meta: [{ name: 'robots', content: 'noindex' }] })
const route = useRoute()
const { user } = useSessionUser()
const query = computed(() => {
  const q = new URLSearchParams()
  // Repeated keys (ba_param) are part of the signed query: keep every value, in order, or the signature no longer matches.
  for (const [k, v] of Object.entries(route.query)) {
    if (k === 'redirect') continue
    for (const item of Array.isArray(v) ? v : [v]) if (typeof item === 'string') q.append(k, item)
  }
  return `?${q.toString()}`
})
const { data: info, error, status, refresh } = useAsyncData('consent', () => oauthApi.consentInfo(query.value), { server: false })
const confirmed = ref(false)
const adminOn = ref(true)
const busy = ref(false)
const failure = ref('')
const done = computed(() => route.query.done as string | undefined)
// mcpwarden:admin appears only from phase 2 (FEATURES.consentAdminScope) and only if the server offers the scope.
const adminScope = computed(() => FEATURES.consentAdminScope ? info.value?.scopes.find(s => s.name === 'mcpwarden:admin') : undefined)
const required = computed(() => info.value?.scopes.filter(s => s.required && s.name !== 'mcpwarden:admin') ?? [])
const unknown = computed(() => info.value && !info.value.client.allowlisted)
const canAllow = computed(() => !unknown.value || confirmed.value)

async function decide(accept: boolean) {
  busy.value = true; failure.value = ''
  try {
    const scopes = [...required.value.map(s => s.name), ...(adminScope.value && adminOn.value ? ['mcpwarden:admin'] : [])]
    const r = await oauthApi.consent(accept, scopes, query.value)
    const target = r.redirectURI ?? r.url
    if (target) window.location.assign(target)
  } catch (e) { failure.value = e instanceof ApiError ? e.message : t('auth.consent.unexpectedError') } finally { busy.value = false }
}
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <p v-if="done" role="status" class="text-[13px]">{{ done === 'granted' ? $t('auth.consent.granted') : $t('auth.consent.denied') }}</p>
    <LoadingRows v-else-if="status === 'pending' && !info" :rows="4" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <div v-else-if="info" class="flex flex-col gap-5">
      <div>
        <h1 class="text-lg font-semibold">{{ $t('auth.consent.title') }}</h1>
        <div class="text-[13px] text-muted-foreground">{{ $t('auth.consent.signedInAs', { email: user?.email }) }}</div>
      </div>
      <Alert v-if="unknown" role="alert" class="border-warn-border bg-warn-bg text-warn-fg">
        <div class="font-semibold">{{ $t('auth.consent.unknownClient') }}</div>
        <dl class="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[13px]">
          <dt>{{ $t('auth.consent.name') }}</dt><dd class="font-medium">{{ info.client.name }}</dd>
          <dt>{{ $t('auth.consent.redirect') }}</dt>
          <dd class="mono text-xs">
            <template v-for="r in info.client.redirects" :key="r.uri"><div><strong>{{ r.host }}</strong><span class="opacity-80">{{ r.uri.slice(r.uri.indexOf(r.host) + r.host.length) }}</span></div></template>
          </dd>
          <dt>{{ $t('auth.consent.registered') }}</dt><dd><RelativeTime :value="info.client.registeredAt" />{{ info.client.viaDcr ? $t('auth.consent.viaDcr') : '' }}</dd>
        </dl>
        <p class="mt-2 text-[13px]">{{ $t('auth.consent.unverifiedName') }}</p>
      </Alert>
      <div v-else class="text-[13px]">
        <i18n-t keypath="auth.consent.wantsAccess" tag="span">
          <template #client><strong>{{ info.client.name }}</strong></template>
          <template #host><strong class="mono">{{ info.client.redirects[0]?.host }}</strong></template>
        </i18n-t>
      </div>
      <Alert v-if="info.loopback" role="alert" class="border-warn-border bg-warn-bg text-warn-fg text-[13px]">
        {{ $t('auth.consent.loopback') }}
      </Alert>
      <section :aria-label="$t('auth.consent.permissions')" class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold">{{ $t('auth.consent.clientMay') }}</h2>
        <ul class="flex flex-col gap-2">
          <li v-for="s in required.filter(r => r.name === 'mcp:tools')" :key="s.name" class="flex flex-col gap-0.5 rounded-sm border bg-card px-3 py-2.5">
            <div class="flex items-center justify-between gap-2"><span class="font-medium">{{ scopeLabel(s.name) }}</span><code class="text-xs text-secondary-foreground">{{ s.name }}</code></div>
            <div class="text-[13px] text-secondary-foreground">{{ $t('auth.consent.useTools') }}</div>
          </li>
          <li v-if="adminScope" class="flex items-start justify-between gap-3 rounded-sm border border-input-strong bg-table-head px-3 py-2.5">
            <div>
              <div class="flex items-center gap-2"><label for="scope-admin" class="font-medium">{{ scopeLabel('mcpwarden:admin') }}</label><code class="text-xs text-secondary-foreground">mcpwarden:admin</code></div>
              <div class="text-[13px] text-secondary-foreground">{{ $t('auth.consent.adminDesc') }}</div>
            </div>
            <Switch id="scope-admin" v-model="adminOn" />
          </li>
        </ul>
        <p class="text-xs text-muted-foreground">{{ $t('auth.consent.stayLoggedIn') }}</p>
      </section>
      <label v-if="unknown" class="flex min-h-11 cursor-pointer items-start gap-3 text-[13px]">
        <Checkbox v-model="confirmed" class="mt-0.5 size-5" :aria-label="$t('auth.consent.confirmWarning')" />
        <span>{{ $t('auth.consent.knowClient') }}</span>
      </label>
      <p v-if="failure" role="alert" class="text-sm text-destructive">{{ failure }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="decide(false)">{{ $t('auth.consent.deny') }}</Button>
        <Button :disabled="!canAllow || busy" @click="decide(true)">{{ $t('auth.consent.allow') }}</Button>
      </div>
      <p class="text-xs text-muted-foreground">{{ $t('auth.consent.revokeHint') }}</p>
    </div>
  </div>
</template>
