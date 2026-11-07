<script setup lang="ts">
import type { UpstreamTestResult as TestResultT } from '#shared/api-types'
import { toast } from 'vue-sonner'
import { upstreamApi } from '~/api'
import ConfirmDialog from '~/components/common/ConfirmDialog.vue'
import ErrorState from '~/components/common/ErrorState.vue'
import FormRow from '~/components/common/FormRow.vue'
import KpiCard from '~/components/common/KpiCard.vue'
import LoadingRows from '~/components/common/LoadingRows.vue'
import RelativeTime from '~/components/common/RelativeTime.vue'
import SecretField from '~/components/common/SecretField.vue'
import StatusBadge from '~/components/common/StatusBadge.vue'
import PageHeader from '~/components/shell/PageHeader.vue'
import { Alert } from '~/components/ui/alert'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'
import TestResult from '~/components/upstreams/TestResult.vue'
import ToolTable from '~/components/upstreams/ToolTable.vue'
import { formatCountdown, formatMs } from '~/lib/format'
import { authTypeLabel, typeLabel } from '~/lib/labels'
import { useZodForm } from '~/lib/useZodForm'
import { secretSchema } from '~/lib/zod-schemas'

const route = useRoute()
const id = String(route.params.id)
const up = useApi(`up-${id}`, () => upstreamApi.get(id))
const tools = useApi(`tools-${id}`, () => upstreamApi.tools(id))
const tab = computed({ get: () => (['tools', 'auth'].includes(String(route.query.tab)) ? String(route.query.tab) : 'overview'), set: v => navigateTo({ query: { tab: v === 'overview' ? undefined : v } }, { replace: true }) })
const u = computed(() => up.data.value)
useHead(() => ({ title: `${u.value?.name ?? 'Upstream'} · mcpwarden` }))

const test = ref<TestResultT | null>(null)
const testing = ref(false)
async function runTest() {
  testing.value = true
  try { test.value = await upstreamApi.test(id); await Promise.all([up.refresh(), tools.refresh()]) } catch { toast.error('Test fehlgeschlagen.') } finally { testing.value = false }
}
async function toggleEnabled() { if (!u.value) return; try { await upstreamApi.patch(id, { enabled: !u.value.enabled }); await up.refresh() } catch { toast.error('Speichern fehlgeschlagen.') } }
const del = ref(false)
async function doDelete() { try { await upstreamApi.remove(id); toast.success('Upstream gelöscht.'); await navigateTo('/upstreams') } catch { toast.error('Löschen fehlgeschlagen.') } del.value = false }

const sec = useZodForm(secretSchema, { value: '' })
const [secret] = sec.form.defineField('value')
const replaced = ref(false)
const saveSecret = sec.submit(async (v) => {
  try { await upstreamApi.putSecret(id, { kind: u.value?.authType === 'header' ? 'header' : 'bearer', name: u.value?.authHeaderName ?? undefined, value: v.value }) } finally { sec.form.resetForm({ values: { value: '' } }) }
  replaced.value = true; await up.refresh(); toast.success('Secret ersetzt.')
}, ['value'])
// OAuth against the upstream: the browser leaves for the upstream's authorization server and returns with ?oauth=ok|denied|error
const connecting = ref(false)
async function oauthConnect() {
  connecting.value = true
  try {
    const r = await upstreamApi.oauthStart(id)
    if (r.authorizationUrl) { window.location.href = r.authorizationUrl; return }
    await up.refresh(); toast.success('Verbunden.')
  } catch { toast.error('Verbindung konnte nicht gestartet werden. Bietet der Upstream OAuth mit Dynamic Client Registration an?') } finally { connecting.value = false }
}
async function oauthDisconnect() {
  try { await upstreamApi.oauthDisconnect(id); await up.refresh(); toast.success('Verbindung getrennt.') } catch { toast.error('Trennen fehlgeschlagen.') }
}
onMounted(async () => {
  const r = String(route.query.oauth ?? '')
  if (!r) return
  await navigateTo({ query: { tab: 'auth' } }, { replace: true })
  if (r === 'ok') { toast.success('Verbunden.'); await runTest() } else toast.error(r === 'denied' ? 'Der Zugriff wurde beim Upstream abgelehnt.' : 'Die Anmeldung beim Upstream ist fehlgeschlagen.')
})
// Tabs as in the draft: underline in the accent color, 44 px high.
const TABS = [['overview', 'Übersicht'], ['tools', 'Tools'], ['auth', 'Auth']] as const
const TAB_CLASS = '-mb-px h-11 flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-4 text-secondary-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:border-transparent dark:data-[state=active]:border-b-primary dark:data-[state=active]:bg-transparent'
const saveTool = (name: string, enabled: boolean) => upstreamApi.setTool(id, name, enabled)
</script>

<template>
  <ErrorState v-if="up.error.value" :error="up.error.value" @retry="up.refresh()" />
  <LoadingRows v-else-if="!u" :rows="5" />
  <template v-else>
    <PageHeader :title="u.name" :crumbs="[{ label: 'Upstreams', to: '/upstreams' }]">
      <template #status><StatusBadge :status="u.status" :setup="u.setup" /></template>
      <Button variant="outline" :disabled="testing" @click="runTest">Verbindung testen</Button>
      <Button variant="outline" @click="toggleEnabled">{{ u.enabled ? 'Deaktivieren' : 'Aktivieren' }}</Button>
      <Button as-child variant="outline"><NuxtLink :to="`/upstreams/${id}/edit`">Bearbeiten</NuxtLink></Button>
      <Button variant="destructive-outline" @click="del = true">Löschen</Button>
    </PageHeader>
    <Alert v-if="u.statusReason || u.setup === 'awaiting_approval'" role="status" class="border-warn-border bg-warn-bg text-warn-fg">
      <template v-if="u.setup === 'awaiting_approval'">Wartet auf Freigabe. <NuxtLink :to="`/upstreams/${id}/approve`" class="font-semibold underline">Entwurf prüfen</NuxtLink></template>
      <template v-else>{{ u.statusReason }}<span v-if="u.nextRetryAt"> Nächster Versuch in {{ formatCountdown(u.nextRetryAt) }}.</span></template>
    </Alert>
    <TestResult v-if="test" :result="test" />

    <Tabs v-model="tab">
      <TabsList class="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0">
        <TabsTrigger v-for="[v, l] in TABS" :key="v" :value="v" :class="TAB_CLASS">{{ l }}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" class="mt-4 flex flex-col gap-4">
        <div class="grid grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-3">
          <KpiCard label="Tools aktiv" :value="`${u.toolsEnabled} / ${u.toolsTotal}`" />
          <KpiCard v-if="u.p95Ms != null" label="p95" :value="formatMs(u.p95Ms)" />
          <KpiCard label="Rate-Limit-Treffer (5 min)" :value="String(u.rateLimitHits5m)" />
        </div>
        <section class="rounded-lg border bg-card p-5" aria-labelledby="h-det">
          <h2 id="h-det" class="mb-3 text-[15px] font-semibold">Details</h2>
          <dl class="grid grid-cols-[160px_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt class="text-muted-foreground">Typ</dt><dd>{{ typeLabel(u.type) }}</dd>
            <dt class="text-muted-foreground">Kurzname</dt><dd><code>{{ u.slug }}</code></dd>
            <dt class="text-muted-foreground">{{ u.type === 'http' ? 'URL' : 'Befehl' }}</dt><dd class="mono text-xs">{{ u.url ?? u.command }}</dd>
            <dt class="text-muted-foreground">Anmeldung</dt><dd>{{ authTypeLabel(u.authType) }}<Badge v-if="u.hasSecret" variant="secondary" class="ml-2">{{ u.authType === 'oauth' ? 'Verbunden' : 'Gesetzt' }}</Badge></dd>
            <dt class="text-muted-foreground">Rate-Limit</dt><dd class="tnum">{{ u.ratePerMin }} / min · {{ u.maxConcurrent }} parallel</dd>
            <dt class="text-muted-foreground">Timeouts</dt><dd class="tnum">{{ u.timeouts.connectMs / 1000 }} s · {{ u.timeouts.listMs / 1000 }} s · {{ u.timeouts.callMs / 1000 }} s</dd>
            <dt class="text-muted-foreground">Zuletzt erfolgreich</dt><dd><RelativeTime :value="u.lastOkAt" empty="noch nie" /></dd>
          </dl>
        </section>
      </TabsContent>
      <TabsContent value="tools" class="mt-4">
        <section class="overflow-hidden rounded-lg border bg-card">
          <LoadingRows v-if="!tools.data.value && !tools.error.value" />
          <ErrorState v-else-if="tools.error.value" :error="tools.error.value" @retry="tools.refresh()" />
          <p v-else-if="!tools.data.value?.items.length" class="p-5 text-[13px] text-muted-foreground">Noch keine Tools. Teste die Verbindung, um sie abzurufen.</p>
          <div v-else class="overflow-x-auto"><div class="min-w-[640px]"><ToolTable :tools="tools.data.value.items" :save="saveTool" @changed="up.refresh()" /></div></div>
        </section>
      </TabsContent>
      <TabsContent value="auth" class="mt-4">
        <section class="flex max-w-[600px] flex-col gap-3 rounded-lg border bg-card p-5" aria-labelledby="h-auth">
          <h2 id="h-auth" class="text-[15px] font-semibold">Anmeldung: {{ authTypeLabel(u.authType) }}</h2>
          <template v-if="u.authType === 'none'"><p class="text-[13px] text-muted-foreground">Dieser Upstream braucht keine Anmeldedaten.</p></template>
          <template v-else-if="u.authType === 'oauth'">
            <p class="text-sm">Zustand: <Badge variant="secondary" data-testid="oauth-state">{{ u.hasSecret ? 'Verbunden' : 'Nicht verbunden' }}</Badge></p>
            <p class="text-[13px] text-muted-foreground">Du meldest dich im Browser beim Upstream an. mcpwarden speichert die Tokens verschlüsselt und erneuert sie selbst; sie werden nie angezeigt.</p>
            <div class="flex flex-wrap gap-2">
              <Button type="button" :disabled="connecting" :aria-busy="connecting" @click="oauthConnect"><Spinner v-if="connecting" />{{ u.hasSecret ? 'Neu verbinden' : 'Mit Upstream verbinden' }}</Button>
              <Button v-if="u.hasSecret" type="button" variant="outline" @click="oauthDisconnect">Trennen</Button>
            </div>
          </template>
          <template v-else>
            <p class="text-sm">Zustand: <Badge variant="secondary">{{ u.hasSecret ? 'Gesetzt' : 'Nicht gesetzt' }}</Badge></p>
            <p v-if="replaced" role="status" class="text-[13px] text-ok-fg">Das Secret wurde ersetzt.</p>
            <form class="flex flex-col gap-3" novalidate @submit.prevent="saveSecret">
              <FormRow id="a-secret" label="Neues Secret" description="Gespeicherte Secrets werden nie angezeigt, nur ersetzt." :error="sec.form.errors.value.value">
                <template #default="{ id, invalid, describedby }"><SecretField :id="id" v-model="secret" :invalid="invalid" :describedby="describedby" /></template>
              </FormRow>
              <div><Button type="submit" :disabled="sec.busy.value">Ersetzen</Button></div>
            </form>
          </template>
        </section>
      </TabsContent>
    </Tabs>
    <ConfirmDialog :open="del" title="Upstream löschen?" confirm-label="Löschen" @update:open="del = $event" @confirm="doDelete">
      „{{ u.name }}“ wird mit Secrets und Tool-Einstellungen gelöscht. Clients verlieren die {{ u.toolsTotal }} Tools sofort.
    </ConfirmDialog>
  </template>
</template>
