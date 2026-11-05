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
useHead({ title: 'Zugriff erlauben · mcpwarden', meta: [{ name: 'robots', content: 'noindex' }] })
const route = useRoute()
const { user } = useSessionUser()
const query = computed(() => {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(route.query)) if (k !== 'redirect' && typeof v === 'string') q.set(k, v)
  return `?${q.toString()}`
})
const { data: info, error, status, refresh } = useAsyncData('consent', () => oauthApi.consentInfo(query.value), { server: false })
const confirmed = ref(false)
const adminOn = ref(true)
const busy = ref(false)
const failure = ref('')
const done = computed(() => route.query.done as string | undefined)
// mcpwarden:admin erscheint erst ab Phase 2 (FEATURES.consentAdminScope) und nur, wenn der Server den Scope anbietet.
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
  } catch (e) { failure.value = e instanceof ApiError ? e.message : 'Unerwarteter Fehler.' } finally { busy.value = false }
}
</script>

<template>
  <div class="w-full max-w-[480px] rounded-lg border bg-card p-7 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
    <p v-if="done" role="status" class="text-[13px]">{{ done === 'granted' ? 'Zugriff erlaubt. Du kannst zum Client zurückkehren.' : 'Zugriff abgelehnt. Der Client wurde informiert (access_denied).' }}</p>
    <LoadingRows v-else-if="status === 'pending' && !info" :rows="4" />
    <ErrorState v-else-if="error" :error="error" @retry="refresh()" />
    <div v-else-if="info" class="flex flex-col gap-5">
      <div>
        <h1 class="text-lg font-semibold">Zugriff erlauben?</h1>
        <div class="text-[13px] text-muted-foreground">Angemeldet als {{ user?.email }}</div>
      </div>
      <Alert v-if="unknown" role="alert" class="border-[#fcd34d] bg-[#fef3c7] text-[#78350f]">
        <div class="font-semibold">Unbekannter Client, nicht in der Allowlist</div>
        <dl class="mt-2 grid grid-cols-[90px_minmax(0,1fr)] gap-x-2.5 gap-y-1 text-[13px]">
          <dt>Name</dt><dd class="font-medium">{{ info.client.name }}</dd>
          <dt>Redirect</dt>
          <dd class="mono text-xs">
            <template v-for="r in info.client.redirects" :key="r.uri"><div><strong>{{ r.host }}</strong><span class="opacity-80">{{ r.uri.slice(r.uri.indexOf(r.host) + r.host.length) }}</span></div></template>
          </dd>
          <dt>Registriert</dt><dd><RelativeTime :value="info.client.registeredAt" />{{ info.client.viaDcr ? ', per Dynamic Client Registration' : '' }}</dd>
        </dl>
        <p class="mt-2 text-[13px]">Der Name wurde vom Client selbst angegeben und ist nicht geprüft. Erlaube nur, was du selbst gestartet hast.</p>
      </Alert>
      <div v-else class="text-[13px]">
        <strong>{{ info.client.name }}</strong> möchte auf dein Konto zugreifen. Weiterleitung an <strong class="mono">{{ info.client.redirects[0]?.host }}</strong>.
      </div>
      <Alert v-if="info.loopback" role="alert" class="border-[#fcd34d] bg-[#fef3c7] text-[#78350f] text-[13px]">
        Der Client leitet an eine Adresse auf diesem Rechner (localhost) zurück. Das ist bei lokalen Tools normal, bei fremden Programmen aber ein Warnzeichen.
      </Alert>
      <section aria-label="Berechtigungen" class="flex flex-col gap-2">
        <h2 class="text-sm font-semibold">Dieser Client darf</h2>
        <ul class="flex flex-col gap-2">
          <li v-for="s in required.filter(r => r.name === 'mcp:tools')" :key="s.name" class="flex flex-col gap-0.5 rounded-sm border bg-card px-3 py-2.5">
            <div class="flex items-center justify-between gap-2"><span class="font-medium">{{ scopeLabel(s.name) }}</span><code class="text-xs text-secondary-foreground">{{ s.name }}</code></div>
            <div class="text-[13px] text-secondary-foreground">Deine aktivierten Upstream-Tools nutzen. Immer enthalten.</div>
          </li>
          <li v-if="adminScope" class="flex items-start justify-between gap-3 rounded-sm border border-input-strong bg-table-head px-3 py-2.5">
            <div>
              <div class="flex items-center gap-2"><label for="scope-admin" class="font-medium">{{ scopeLabel('mcpwarden:admin') }}</label><code class="text-xs text-secondary-foreground">mcpwarden:admin</code></div>
              <div class="text-[13px] text-secondary-foreground">Upstreams anlegen, ändern und entfernen. Secrets bleiben ausgeschlossen: Tokens gibst du nur in der Web-UI ein.</div>
            </div>
            <Switch id="scope-admin" v-model="adminOn" />
          </li>
        </ul>
        <p class="text-xs text-muted-foreground">Dazu: angemeldet bleiben, damit der Client sich ohne erneute Abfrage verlängern kann.</p>
      </section>
      <label v-if="unknown" class="flex min-h-11 cursor-pointer items-start gap-3 text-[13px]">
        <Checkbox v-model="confirmed" class="mt-0.5 size-5" aria-label="Warnung bestätigen" />
        <span>Ich kenne diesen Client und möchte ihm trotz der Warnung Zugriff geben.</span>
      </label>
      <p v-if="failure" role="alert" class="text-sm text-destructive">{{ failure }}</p>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" :disabled="busy" @click="decide(false)">Ablehnen</Button>
        <Button :disabled="!canAllow || busy" @click="decide(true)">Zugriff erlauben</Button>
      </div>
      <p class="text-xs text-muted-foreground">Du kannst den Zugriff jederzeit unter Clients widerrufen. Das Token gilt nur für diese Gateway-URL.</p>
    </div>
  </div>
</template>
